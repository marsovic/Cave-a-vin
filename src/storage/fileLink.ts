/**
 * Fichier CSV « lié » via la File System Access API (Chrome / Edge sur ordinateur) :
 * l'application relit et réécrit directement le fichier choisi (par exemple dans un
 * dossier OneDrive synchronisé). Le descripteur est conservé dans IndexedDB pour
 * retrouver le fichier d'une session à l'autre.
 */

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

/** L'API est-elle disponible dans ce navigateur ? (faux sur iPhone / Firefox / Safari) */
export function isFileLinkSupported(): boolean {
  throw new Error('non implémenté');
}

/** Ouvre le sélecteur pour choisir un CSV existant et le lie. `null` si l'utilisateur annule. */
export async function pickLinkedFile(): Promise<LinkedFileInfo | null> {
  throw new Error('non implémenté');
}

/** Ouvre « Enregistrer sous » pour créer un nouveau CSV et le lie. `null` si l'utilisateur annule. */
export async function createLinkedFile(suggestedName: string): Promise<LinkedFileInfo | null> {
  void suggestedName;
  throw new Error('non implémenté');
}

/** Retrouve le fichier lié lors d'une session précédente (sans rien demander à l'utilisateur). */
export async function restoreLinkedFile(): Promise<LinkedFileInfo | null> {
  throw new Error('non implémenté');
}

/** Redemande l'autorisation de lecture/écriture (à appeler depuis un geste utilisateur). */
export async function requestLinkPermission(): Promise<LinkPermission> {
  throw new Error('non implémenté');
}

/** Lit le fichier lié (décodage UTF-8 avec repli Windows-1252). Lève une erreur française si impossible. */
export async function readLinkedFile(): Promise<LinkedFileContent> {
  throw new Error('non implémenté');
}

/** Date de dernière modification du fichier lié, ou `null` si illisible. */
export async function linkedFileModifiedAt(): Promise<number | null> {
  throw new Error('non implémenté');
}

/** Écrit le CSV dans le fichier lié (UTF-8 avec BOM). Renvoie la nouvelle date de modification. */
export async function writeLinkedFile(csv: string): Promise<number> {
  void csv;
  throw new Error('non implémenté');
}

/** Oublie le fichier lié. */
export async function unlinkFile(): Promise<void> {
  throw new Error('non implémenté');
}
