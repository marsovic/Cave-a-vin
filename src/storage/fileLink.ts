/**
 * Fichier CSV « lié » via la File System Access API (Chrome / Edge sur ordinateur) :
 * l'application relit et réécrit directement le fichier choisi (par exemple dans un
 * dossier OneDrive synchronisé). Le descripteur est conservé dans IndexedDB pour
 * retrouver le fichier d'une session à l'autre.
 */
import { decodeText } from './transfer';

export type LinkPermission = 'granted' | 'prompt' | 'denied';

export interface LinkedFileInfo {
  name: string;
  permission: LinkPermission;
}

export interface LinkedFileContent {
  text: string;
  /** Date de dernière modification du fichier (ms epoch). */
  lastModified: number;
}

/* ---------- Types minimaux de la File System Access API (absents de certaines lib.dom) ---------- */

interface WritableLike {
  write(data: string | Blob | BufferSource): Promise<void>;
  close(): Promise<void>;
  abort?(reason?: unknown): Promise<void>;
}

/** Sous-ensemble de `FileSystemFileHandle` utilisé ici (facilite aussi les tests). */
export interface FileHandleLike {
  readonly name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<WritableLike>;
  queryPermission?(descriptor: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
  requestPermission?(descriptor: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
}

interface PickerOptions {
  id?: string;
  multiple?: boolean;
  suggestedName?: string;
  excludeAcceptAllOption?: boolean;
  types?: { description: string; accept: Record<string, string[]> }[];
}

interface PickerWindow {
  showOpenFilePicker?: (options?: PickerOptions) => Promise<FileHandleLike[]>;
  showSaveFilePicker?: (options?: PickerOptions) => Promise<FileHandleLike>;
  isSecureContext?: boolean;
}

/** Stockage du descripteur entre deux sessions (IndexedDB par défaut, remplaçable pour les tests). */
export interface HandleStore {
  get(): Promise<FileHandleLike | null>;
  set(handle: FileHandleLike): Promise<void>;
  clear(): Promise<void>;
}

const DB_NAME = 'dumbcellar';
/** Base du temps où l'application s'appelait autrement : son descripteur est repris une fois, puis elle est supprimée. */
const LEGACY_DB_NAME = 'bacchus';
const STORE_NAME = 'handles';
const HANDLE_KEY = 'cave';
const FILE_TYPES = [{ description: 'Cave DumbCellar (CSV)', accept: { 'text/csv': ['.csv'] } }];
const BOM = '﻿';

function openDb(name: string = DB_NAME): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB indisponible'));
      return;
    }
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB indisponible'));
    request.onblocked = () => reject(new Error('IndexedDB bloquée'));
  });
}

function idbRun<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
  name: string = DB_NAME,
): Promise<T> {
  return openDb(name).then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, mode);
        const request = run(tx.objectStore(STORE_NAME));
        tx.oncomplete = () => {
          db.close();
          resolve(request.result);
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error ?? new Error('Erreur IndexedDB'));
        };
        tx.onabort = () => {
          db.close();
          reject(tx.error ?? new Error('Transaction IndexedDB annulée'));
        };
      }),
  );
}

function asHandle(value: unknown): FileHandleLike | null {
  return value && typeof value === 'object' && 'getFile' in value ? (value as FileHandleLike) : null;
}

/**
 * Reprend le fichier lié du temps de l'ancien nom de l'application : le descripteur est
 * recopié dans la base actuelle, puis l'ancienne base est supprimée. `null` s'il n'y en a pas.
 */
async function migrateLegacyHandle(): Promise<FileHandleLike | null> {
  try {
    // Sans `databases()`, ouvrir l'ancienne base la créerait : on s'abstient.
    if (typeof indexedDB === 'undefined' || typeof indexedDB.databases !== 'function') return null;
    if (!(await indexedDB.databases()).some((db) => db.name === LEGACY_DB_NAME)) return null;
    const handle = asHandle(await idbRun<unknown>('readonly', (s) => s.get(HANDLE_KEY), LEGACY_DB_NAME));
    if (handle) await idbRun('readwrite', (s) => s.put(handle, HANDLE_KEY));
    indexedDB.deleteDatabase(LEGACY_DB_NAME);
    return handle;
  } catch {
    return null;
  }
}

const indexedDbStore: HandleStore = {
  async get() {
    try {
      const read = async (): Promise<FileHandleLike | null> =>
        asHandle(await idbRun<unknown>('readonly', (s) => s.get(HANDLE_KEY)));
      // Reprise sans résultat : une autre fenêtre vient peut-être de la faire, d'où la relecture.
      return (await read()) ?? (await migrateLegacyHandle()) ?? (await read());
    } catch {
      return null;
    }
  },
  async set(handle) {
    try {
      await idbRun('readwrite', (s) => s.put(handle, HANDLE_KEY));
    } catch {
      /* le lien fonctionnera pour cette session seulement */
    }
  },
  async clear() {
    try {
      await idbRun('readwrite', (s) => s.delete(HANDLE_KEY));
    } catch {
      /* rien à faire */
    }
  },
};

let handleStore: HandleStore = indexedDbStore;
let current: FileHandleLike | null = null;
/** Descripteur lié avant le dernier choix de fichier (pour y revenir si le nouveau est inutilisable). */
let previous: FileHandleLike | null = null;

function pickerWindow(): PickerWindow | null {
  return typeof window === 'undefined' ? null : (window as unknown as PickerWindow);
}

function isAbort(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && (error as { name?: string }).name === 'AbortError');
}

async function permissionOf(handle: FileHandleLike): Promise<LinkPermission> {
  try {
    // Navigateurs sans gestion fine des permissions : le descripteur fraîchement choisi est utilisable.
    if (!handle.queryPermission) return 'granted';
    return await handle.queryPermission({ mode: 'readwrite' });
  } catch {
    return 'prompt';
  }
}

/** Traduit une erreur du système de fichiers en message français utile. */
function explain(error: unknown, action: 'lire' | 'écrire'): Error {
  const name = error && typeof error === 'object' ? ((error as { name?: string }).name ?? '') : '';
  const file = current?.name ?? 'le fichier';
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return new Error(`Accès à ${file} refusé : reconnectez le fichier (menu Fichier).`);
    case 'NotFoundError':
      return new Error(`${file} est introuvable : il a été déplacé, renommé ou supprimé. Liez de nouveau un fichier.`);
    case 'NoModificationAllowedError':
    case 'InvalidModificationError':
    case 'InvalidStateError':
      return new Error(
        `Impossible d'${action === 'écrire' ? 'écrire dans' : 'utiliser'} ${file} : il est peut-être ouvert dans Excel ou en cours de synchronisation OneDrive. Fermez-le puis réessayez.`,
      );
    case 'NotReadableError':
      return new Error(
        `Impossible de lire ${file} : s'il est « en ligne uniquement » dans OneDrive, connectez-vous à internet ou choisissez « Toujours conserver sur cet appareil ».`,
      );
    case 'QuotaExceededError':
      return new Error(`Espace disque insuffisant pour écrire ${file}.`);
    default:
      return new Error(action === 'écrire' ? `L'écriture de ${file} a échoué.` : `La lecture de ${file} a échoué.`);
  }
}

/** L'API est-elle disponible dans ce navigateur ? (faux sur iPhone / Firefox / Safari) */
export function isFileLinkSupported(): boolean {
  const w = pickerWindow();
  return Boolean(
    w &&
      typeof w.showOpenFilePicker === 'function' &&
      typeof w.showSaveFilePicker === 'function' &&
      w.isSecureContext !== false,
  );
}

async function adopt(handle: FileHandleLike): Promise<LinkedFileInfo> {
  previous = current;
  current = handle;
  await handleStore.set(handle);
  return { name: handle.name, permission: await permissionOf(handle) };
}

/** Ouvre le sélecteur pour choisir un CSV existant et le lie. `null` si l'utilisateur annule. */
export async function pickLinkedFile(): Promise<LinkedFileInfo | null> {
  const w = pickerWindow();
  if (!w?.showOpenFilePicker) throw new Error('Ce navigateur ne permet pas de lier un fichier.');
  try {
    const [handle] = await w.showOpenFilePicker({ id: 'dumbcellar-cave', multiple: false, types: FILE_TYPES });
    if (!handle) return null;
    const info = await adopt(handle);
    if (info.permission !== 'granted') info.permission = await requestLinkPermission();
    return info;
  } catch (error) {
    if (isAbort(error)) return null;
    throw explain(error, 'lire');
  }
}

/** Ouvre « Enregistrer sous » pour créer un nouveau CSV et le lie. `null` si l'utilisateur annule. */
export async function createLinkedFile(suggestedName: string): Promise<LinkedFileInfo | null> {
  const w = pickerWindow();
  if (!w?.showSaveFilePicker) throw new Error('Ce navigateur ne permet pas de lier un fichier.');
  try {
    const handle = await w.showSaveFilePicker({ id: 'dumbcellar-cave', suggestedName, types: FILE_TYPES });
    return await adopt(handle);
  } catch (error) {
    if (isAbort(error)) return null;
    throw explain(error, 'écrire');
  }
}

/** Retrouve le fichier lié lors d'une session précédente (sans rien demander à l'utilisateur). */
export async function restoreLinkedFile(): Promise<LinkedFileInfo | null> {
  if (!isFileLinkSupported()) return null;
  const handle = current ?? (await handleStore.get());
  if (!handle) return null;
  current = handle;
  return { name: handle.name, permission: await permissionOf(handle) };
}

/** Redemande l'autorisation de lecture/écriture (à appeler depuis un geste utilisateur). */
export async function requestLinkPermission(): Promise<LinkPermission> {
  if (!current) return 'denied';
  try {
    if (!current.requestPermission) return await permissionOf(current);
    return await current.requestPermission({ mode: 'readwrite' });
  } catch {
    return 'denied';
  }
}

/** Lit le fichier lié (décodage UTF-8 avec repli Windows-1252). Lève une erreur française si impossible. */
export async function readLinkedFile(): Promise<LinkedFileContent> {
  if (!current) throw new Error('Aucun fichier n\'est lié.');
  try {
    // Toujours redemander un instantané : un objet File conservé devient illisible si le fichier change.
    const file = await current.getFile();
    return { text: decodeText(await file.arrayBuffer()), lastModified: file.lastModified };
  } catch (error) {
    throw explain(error, 'lire');
  }
}

/** Date de dernière modification du fichier lié, ou `null` si illisible. */
export async function linkedFileModifiedAt(): Promise<number | null> {
  if (!current) return null;
  try {
    return (await current.getFile()).lastModified;
  } catch {
    return null;
  }
}

/** Écrit le CSV dans le fichier lié (UTF-8 avec BOM). Renvoie la nouvelle date de modification. */
export async function writeLinkedFile(csv: string): Promise<number> {
  if (!current) throw new Error('Aucun fichier n\'est lié.');
  let writable: WritableLike | null = null;
  try {
    writable = await current.createWritable();
    await writable.write(BOM + csv);
    // Le fichier réel n'est remplacé qu'à la fermeture (écriture atomique).
    await writable.close();
    writable = null;
    return (await current.getFile()).lastModified;
  } catch (error) {
    try {
      await writable?.abort?.();
    } catch {
      /* déjà fermé */
    }
    throw explain(error, 'écrire');
  }
}

/**
 * Annule le dernier choix de fichier (fichier illisible, par exemple) : le fichier lié
 * auparavant le redevient. Renvoie ses informations, ou `null` s'il n'y en avait pas.
 */
export async function revertLinkedFile(): Promise<LinkedFileInfo | null> {
  current = previous;
  previous = null;
  if (!current) {
    await handleStore.clear();
    return null;
  }
  await handleStore.set(current);
  return { name: current.name, permission: await permissionOf(current) };
}

/** Oublie le fichier lié. */
export async function unlinkFile(): Promise<void> {
  current = null;
  previous = null;
  await handleStore.clear();
}

/** Tests : remet le module à zéro et permet d'injecter un stockage de descripteur. */
export function __resetForTests(store?: HandleStore): void {
  current = null;
  previous = null;
  handleStore = store ?? indexedDbStore;
}
