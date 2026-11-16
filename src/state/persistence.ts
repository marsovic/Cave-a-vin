import { resetAiStatusCache } from '../ai/client';
import { DEFAULT_AI_SETTINGS, type AiSettings } from '../ai/types';
import { validateCellar } from '../domain/cellar';
import { CSV_DEFAULT_FILENAME, parseCellarCsv, serializeCellar } from '../domain/csv';
import { demoCellar } from '../domain/demo';
import type { ReorgPlan } from '../domain/reorg';
import type { Bottle, Cellar, DrinkWindow } from '../domain/types';
import {
  createLinkedFile,
  isFileLinkSupported,
  linkedFileModifiedAt,
  pickLinkedFile,
  readLinkedFile,
  requestLinkPermission,
  restoreLinkedFile,
  unlinkFile,
  writeLinkedFile,
} from '../storage/fileLink';
import { loadJson, loadText, removeKey, requestPersistence, saveJson, saveText, STORAGE_KEYS } from '../storage/localStore';
import {
  buildMailto,
  canShareCsv,
  datedFilename,
  downloadCsv,
  extractCsvFromText,
  readTextFile,
  shareCsv,
} from '../storage/transfer';
import { refreshAdvice, refreshAiStatus } from './advice';
import { useStore, type AppState } from './store';
import { DEFAULT_PREFS, type FileState, type Prefs } from './types';

/* ------------------------------------------------------------------ */
/* Copie de travail (navigateur)                                       */
/* ------------------------------------------------------------------ */

interface Meta {
  dirty: boolean;
  syncedMtime: number | null;
  lastName: string | null;
  savedAt: number | null;
}

interface ReorgSessionData {
  plan: ReorgPlan;
  index: number;
  horsCave: Bottle[];
  depart: Cellar;
  cellar: Cellar;
}

const AI_CACHE_LIMIT = 600;
let storageWarned = false;

function saveWorkingCopy(cellar: Cellar): void {
  const ok = saveText(STORAGE_KEYS.csv, serializeCellar(cellar));
  if (!ok && !storageWarned) {
    storageWarned = true;
    useStore
      .getState()
      .toast(
        'erreur',
        'Impossible d\'enregistrer dans ce navigateur (stockage plein ou navigation privée). Exportez votre cave pour ne rien perdre.',
      );
  }
}

function saveMeta(file: FileState): void {
  const meta: Meta = {
    dirty: file.dirty,
    syncedMtime: file.syncedMtime,
    lastName: file.lastName,
    savedAt: file.savedAt,
  };
  saveJson(STORAGE_KEYS.meta, meta);
}

function saveReorgSession(state: AppState): void {
  if (state.mode.kind !== 'reorg') {
    removeKey(STORAGE_KEYS.reorg);
    return;
  }
  const data: ReorgSessionData = {
    plan: state.mode.plan,
    index: state.mode.index,
    horsCave: state.mode.horsCave,
    depart: state.mode.depart,
    cellar: state.cellar,
  };
  saveJson(STORAGE_KEYS.reorg, data);
}

function loadReorgSession(): ReorgSessionData | null {
  const data = loadJson<ReorgSessionData | null>(STORAGE_KEYS.reorg, null);
  try {
    if (
      !data ||
      !Array.isArray(data.plan?.steps) ||
      !Number.isInteger(data.index) ||
      data.index < 0 ||
      data.index >= data.plan.steps.length ||
      !Array.isArray(data.horsCave) ||
      !Array.isArray(data.cellar?.bottles) ||
      !Array.isArray(data.cellar?.shelves) ||
      !Array.isArray(data.depart?.bottles) ||
      validateCellar(data.cellar).length > 0
    ) {
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Fichier lié (File System Access API)                                */
/* ------------------------------------------------------------------ */

let writeTimer: ReturnType<typeof setTimeout> | null = null;
let writing = false;
let writeAgain = false;

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/** La cave peut-elle être écrite maintenant (aucune bouteille momentanément hors cave) ? */
function isStable(state: AppState): boolean {
  return state.mode.kind !== 'reorg' || state.mode.horsCave.length === 0;
}

async function writeNow(force = false): Promise<void> {
  const state = useStore.getState();
  const { file } = state;
  if (!file.linked || file.linked.permission !== 'granted') return;
  if (file.conflict && !force) return;
  if (!isStable(state)) return;
  if (writing) {
    writeAgain = true;
    return;
  }
  writing = true;
  try {
    if (!force && file.syncedMtime !== null) {
      const mtime = await linkedFileModifiedAt();
      if (mtime !== null && mtime > file.syncedMtime) {
        // Le fichier a changé ailleurs (autre appareil, OneDrive, tableur) : on ne l'écrase pas.
        useStore.getState().setFile({ conflict: true });
        return;
      }
    }
    const mtime = await writeLinkedFile(serializeCellar(useStore.getState().cellar));
    useStore.getState().setFile({ syncedMtime: mtime, dirty: false, conflict: false, error: null, savedAt: Date.now() });
  } catch (error) {
    useStore.getState().setFile({ error: errorMessage(error, 'Impossible d\'écrire dans le fichier lié.') });
  } finally {
    writing = false;
    if (writeAgain) {
      writeAgain = false;
      void writeNow();
    }
  }
}

function scheduleWrite(): void {
  if (writeTimer) clearTimeout(writeTimer);
  writeTimer = setTimeout(() => {
    writeTimer = null;
    void writeNow();
  }, 700);
}

/** Recharge la cave depuis le fichier lié s'il a été modifié ailleurs. */
async function syncFromLinkedFile(): Promise<void> {
  const { file } = useStore.getState();
  if (!file.linked || file.linked.permission !== 'granted' || writing) return;
  const mtime = await linkedFileModifiedAt();
  if (mtime === null) return;
  if (file.syncedMtime !== null && mtime <= file.syncedMtime) {
    if (file.dirty) scheduleWrite();
    return;
  }
  if (file.dirty) {
    useStore.getState().setFile({ conflict: true });
    return;
  }
  await loadFromLinkedFile(true);
}

async function loadFromLinkedFile(silent: boolean): Promise<boolean> {
  const store = useStore.getState();
  try {
    const content = await readLinkedFile();
    const parsed = parseCellarCsv(content.text);
    if (!parsed.cellar) {
      store.setFile({ error: parsed.errors[0] ?? 'Le fichier lié est illisible.' });
      if (!silent) store.openDialog({ kind: 'info', title: 'Fichier illisible', message: parsed.errors.join('\n') });
      return false;
    }
    const name = useStore.getState().file.linked?.name ?? 'le fichier';
    useStore.getState().replaceCellar(parsed.cellar, `Chargement de ${name}`);
    useStore.getState().setFile({
      syncedMtime: content.lastModified,
      dirty: false,
      conflict: false,
      error: null,
      savedAt: content.lastModified,
      lastName: name,
    });
    store.toast(
      'info',
      silent
        ? `Cave rechargée depuis ${name} (modifié ailleurs).`
        : `Cave chargée depuis ${name} : ${parsed.stats.bouteilles} bouteille(s).`,
    );
    if (!silent && parsed.warnings.length > 0) showImportWarnings(parsed.warnings);
    return true;
  } catch (error) {
    store.setFile({ error: errorMessage(error, 'Impossible de lire le fichier lié.') });
    return false;
  }
}

function showImportWarnings(warnings: string[]): void {
  useStore.getState().openDialog({
    kind: 'info',
    title: `Import terminé avec ${warnings.length} remarque(s)`,
    message: 'Le fichier a été lu, mais certaines lignes ont dû être corrigées ou ignorées :',
    details: warnings,
  });
}

/** « Ouvrir un fichier CSV et le lier » : la cave devient le contenu du fichier. */
export async function openLinkedFile(): Promise<void> {
  const store = useStore.getState();
  try {
    const info = await pickLinkedFile();
    if (!info) return;
    store.setFile({ linked: info, conflict: false, error: null, syncedMtime: null });
    const ok = await loadFromLinkedFile(false);
    if (!ok) {
      await unlinkFile();
      useStore.getState().setFile({ linked: null });
      store.toast('erreur', useStore.getState().file.error ?? 'Ce fichier n\'a pas pu être ouvert.');
    }
  } catch (error) {
    store.toast('erreur', errorMessage(error, 'Ce fichier n\'a pas pu être ouvert.'));
  }
}

/** « Enregistrer sous… et lier » : crée un fichier CSV qui sera ensuite tenu à jour automatiquement. */
export async function saveAsLinkedFile(): Promise<void> {
  const store = useStore.getState();
  try {
    const info = await createLinkedFile(store.file.linked?.name ?? store.file.lastName ?? CSV_DEFAULT_FILENAME);
    if (!info) return;
    store.setFile({ linked: info, conflict: false, error: null, syncedMtime: null, lastName: info.name });
    await writeNow(true);
    const { file } = useStore.getState();
    if (file.error) store.toast('erreur', file.error);
    else store.toast('succes', `Cave enregistrée dans ${info.name}. Ce fichier sera tenu à jour automatiquement.`);
  } catch (error) {
    store.toast('erreur', errorMessage(error, 'Le fichier n\'a pas pu être créé.'));
  }
}

/** Redemande l'accès au fichier lié (le navigateur l'exige à chaque nouvelle session). */
export async function reconnectLinkedFile(): Promise<void> {
  const store = useStore.getState();
  const linked = store.file.linked;
  if (!linked) return;
  try {
    const permission = await requestLinkPermission();
    store.setFile({ linked: { ...linked, permission } });
    if (permission !== 'granted') {
      store.toast('erreur', `Accès à ${linked.name} refusé. La cave reste enregistrée dans ce navigateur.`);
      return;
    }
    await syncFromLinkedFile();
    const { file } = useStore.getState();
    if (!file.conflict && !file.error) store.toast('succes', `${linked.name} reconnecté.`);
  } catch (error) {
    store.toast('erreur', errorMessage(error, 'Impossible de reconnecter le fichier.'));
  }
}

export async function unlinkLinkedFile(): Promise<void> {
  if (writeTimer) clearTimeout(writeTimer);
  writeTimer = null;
  try {
    await unlinkFile();
  } catch {
    /* rien à faire */
  }
  useStore.getState().setFile({ linked: null, conflict: false, error: null, syncedMtime: null });
  useStore.getState().toast('info', 'Fichier délié. La cave reste enregistrée dans ce navigateur.');
}

/** Conflit : garder la version du fichier (la cave locale est remplacée, annulable). */
export async function resolveConflictWithFile(): Promise<void> {
  await loadFromLinkedFile(false);
}

/** Conflit : garder la cave affichée et écraser le fichier. */
export async function resolveConflictWithLocal(): Promise<void> {
  await writeNow(true);
  const { file } = useStore.getState();
  if (file.error) useStore.getState().toast('erreur', file.error);
  else useStore.getState().toast('succes', 'Fichier mis à jour avec la cave affichée.');
}

/* ------------------------------------------------------------------ */
/* Import / export sans lien                                           */
/* ------------------------------------------------------------------ */

/** Remplace la cave par le contenu d'un CSV (après confirmation si la cave n'est pas vide). */
export function importCsvText(text: string, name: string | null): boolean {
  const store = useStore.getState();
  const parsed = parseCellarCsv(text);
  if (!parsed.cellar) {
    store.openDialog({
      kind: 'info',
      title: 'Import impossible',
      message: parsed.errors.join('\n') || 'Ce fichier n\'est pas un CSV de cave reconnu.',
    });
    return false;
  }
  const cellar = parsed.cellar;
  const apply = (): void => {
    useStore.getState().replaceCellar(cellar, name ? `Import de ${name}` : 'Import d\'une cave');
    useStore.getState().setFile({ lastName: name ?? useStore.getState().file.lastName });
    useStore.getState().closeDialog();
    useStore
      .getState()
      .toast('succes', `Cave importée : ${parsed.stats.bouteilles} bouteille(s), ${parsed.stats.clayettes} clayette(s).`, {
        undo: true,
      });
    if (parsed.warnings.length > 0) showImportWarnings(parsed.warnings);
  };
  const current = store.cellar.bottles.length;
  if (current === 0) {
    apply();
    return true;
  }
  store.openDialog({
    kind: 'confirm',
    title: 'Remplacer la cave actuelle ?',
    message: `La cave actuelle (${current} bouteille(s)) sera remplacée par le contenu importé (${parsed.stats.bouteilles} bouteille(s)). Vous pourrez annuler juste après.`,
    confirmLabel: 'Remplacer',
    danger: true,
    onConfirm: apply,
  });
  return true;
}

export async function importFile(file: File): Promise<void> {
  try {
    const text = await readTextFile(file);
    importCsvText(text, file.name);
  } catch (error) {
    useStore.getState().toast('erreur', errorMessage(error, 'Ce fichier n\'a pas pu être lu.'));
  }
}

/** Import par collage (corps d'un courriel, par exemple). */
export function importPastedText(text: string): boolean {
  const csv = extractCsvFromText(text);
  if (!csv) {
    useStore.getState().openDialog({
      kind: 'info',
      title: 'Import impossible',
      message:
        'Aucun tableau de cave n\'a été reconnu dans le texte collé. Collez le contenu complet du fichier CSV, ligne d\'en-tête comprise.',
    });
    return false;
  }
  return importCsvText(csv, null);
}

function markExported(name: string): void {
  const { file } = useStore.getState();
  // Avec un fichier lié, « à jour » se rapporte au fichier lié, pas à une copie exportée.
  useStore.getState().setFile(file.linked ? { lastName: name } : { dirty: false, lastName: name, savedAt: Date.now() });
}

export function exportDownload(): void {
  const { cellar } = useStore.getState();
  const name = datedFilename();
  downloadCsv(serializeCellar(cellar), name);
  markExported(name);
  useStore.getState().toast('succes', `Fichier ${name} téléchargé.`);
}

/** Partage (feuille de partage : Mail, Fichiers, OneDrive…). Renvoie `false` si indisponible. */
export async function exportShare(): Promise<boolean> {
  const { cellar } = useStore.getState();
  const name = datedFilename();
  const result = await shareCsv(serializeCellar(cellar), name, {
    title: 'Ma cave — Bacchus SmartCellar',
    text: `Cave Bacchus SmartCellar : ${cellar.bottles.length} bouteille(s).`,
  });
  if (result === 'shared') {
    markExported(name);
    useStore.getState().toast('succes', 'Cave partagée.');
    return true;
  }
  return result === 'cancelled';
}

export { canShareCsv };

/**
 * Export par courriel. Sur téléphone, passe par la feuille de partage (fichier joint).
 * Sinon : télécharge le fichier et ouvre un brouillon de courriel (le CSV est inséré
 * dans le message s'il est court, sinon il faut joindre le fichier téléchargé).
 */
export async function exportMail(): Promise<void> {
  const { cellar } = useStore.getState();
  if (canShareCsv()) {
    const ok = await exportShare();
    if (ok) return;
  }
  const csv = serializeCellar(cellar);
  const name = datedFilename();
  const mail = buildMailto(csv, {
    subject: `Ma cave Bacchus SmartCellar (${cellar.bottles.length} bouteilles)`,
    intro: 'Bonjour,\r\n\r\nVoici ma cave exportée depuis Bacchus SmartCellar.',
  });
  if (!mail.inline) downloadCsv(csv, name);
  markExported(name);
  window.location.href = mail.href;
  useStore
    .getState()
    .toast(
      'info',
      mail.inline
        ? 'Brouillon de courriel ouvert : la cave est dans le corps du message.'
        : `Brouillon de courriel ouvert : joignez le fichier ${name} qui vient d'être téléchargé.`,
    );
}

/** Charge la cave d'exemple (annulable). */
export function loadDemo(): void {
  const store = useStore.getState();
  const apply = (): void => {
    useStore.getState().replaceCellar(demoCellar(), 'Chargement de la cave d\'exemple');
    useStore.getState().closeDialog();
    useStore.getState().toast('succes', 'Cave d\'exemple chargée. Essayez une recherche ou la réorganisation !', {
      undo: true,
    });
  };
  if (store.cellar.bottles.length === 0) {
    apply();
    return;
  }
  store.openDialog({
    kind: 'confirm',
    title: 'Remplacer la cave actuelle ?',
    message: `La cave actuelle (${store.cellar.bottles.length} bouteille(s)) sera remplacée par la cave d'exemple. Vous pourrez annuler juste après.`,
    confirmLabel: 'Charger l\'exemple',
    danger: true,
    onConfirm: apply,
  });
}

/* ------------------------------------------------------------------ */
/* Initialisation                                                      */
/* ------------------------------------------------------------------ */

let started = false;

/** Charge l'état enregistré, branche les sauvegardes automatiques. À appeler une fois au démarrage. */
export async function initApp(): Promise<void> {
  if (started) return;
  started = true;
  const store = useStore.getState();

  const prefs: Prefs = { ...DEFAULT_PREFS, ...loadJson<Partial<Prefs>>(STORAGE_KEYS.prefs, {}) };
  const ai: AiSettings = { ...DEFAULT_AI_SETTINGS, ...loadJson<Partial<AiSettings>>(STORAGE_KEYS.ai, {}) };
  const aiWindows = loadJson<Record<string, DrinkWindow>>(STORAGE_KEYS.aiCache, {});
  const meta = loadJson<Partial<Meta>>(STORAGE_KEYS.meta, {});

  let cellar: Cellar | null = null;
  let firstRun = false;
  const csv = loadText(STORAGE_KEYS.csv);
  if (csv) {
    const parsed = parseCellarCsv(csv);
    cellar = parsed.cellar;
  } else {
    firstRun = true;
  }

  const patch: Partial<AppState> = {
    ready: true,
    prefs,
    ai,
    aiWindows: aiWindows && typeof aiWindows === 'object' ? aiWindows : {},
    file: {
      ...store.file,
      linkSupported: isFileLinkSupported(),
      dirty: meta.dirty ?? false,
      syncedMtime: meta.syncedMtime ?? null,
      lastName: meta.lastName ?? null,
      savedAt: meta.savedAt ?? null,
    },
  };
  if (cellar) patch.cellar = cellar;

  const session = loadReorgSession();
  if (session) {
    patch.cellar = session.cellar;
    patch.mode = {
      kind: 'reorg',
      plan: session.plan,
      index: session.index,
      horsCave: session.horsCave,
      depart: session.depart,
    };
  }
  if (firstRun && !prefs.accueilVu) patch.dialog = { kind: 'bienvenue' };
  store.hydrate(patch);

  useStore.subscribe((state, prev) => {
    if (!prev.ready) return;
    if (state.cellar !== prev.cellar) {
      if (isStable(state)) saveWorkingCopy(state.cellar);
      if (!state.file.dirty) state.setFile({ dirty: true });
      if (state.file.linked?.permission === 'granted') scheduleWrite();
      if (state.advice) refreshAdvice();
    }
    if (state.mode !== prev.mode) {
      saveReorgSession(state);
      // Fin d'un échange pendant la réorganisation : la cave est de nouveau complète.
      if (state.cellar === prev.cellar && isStable(state) && !isStable(prev)) saveWorkingCopy(state.cellar);
    }
    if (state.prefs !== prev.prefs) saveJson(STORAGE_KEYS.prefs, state.prefs);
    if (state.ai !== prev.ai) {
      saveJson(STORAGE_KEYS.ai, state.ai);
      resetAiStatusCache();
      void refreshAiStatus();
    }
    if (state.aiWindows !== prev.aiWindows) {
      const entries = Object.entries(state.aiWindows);
      saveJson(STORAGE_KEYS.aiCache, Object.fromEntries(entries.slice(-AI_CACHE_LIMIT)));
    }
    if (state.file !== prev.file) saveMeta(state.file);
  });

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void syncFromLinkedFile();
      else if (writeTimer) {
        // L'onglet passe en arrière-plan : on écrit tout de suite.
        clearTimeout(writeTimer);
        writeTimer = null;
        void writeNow();
      }
    });
  }

  void requestPersistence();
  void refreshAiStatus();

  if (isFileLinkSupported()) {
    try {
      const info = await restoreLinkedFile();
      if (info) {
        useStore.getState().setFile({ linked: info });
        if (info.permission === 'granted') await syncFromLinkedFile();
      }
    } catch {
      /* pas de fichier lié récupérable */
    }
  }
}
