/**
 * Import / export du CSV sans File System Access API : téléchargement, partage
 * (feuille de partage iOS/Android/Windows : Mail, Fichiers, OneDrive…), courriel, lecture de fichier.
 */

/** Décode le contenu d'un fichier texte : UTF-8 (BOM retiré), repli Windows-1252 si l'UTF-8 est invalide. */
export function decodeText(bytes: ArrayBuffer | Uint8Array): string {
  void bytes;
  throw new Error('non implémenté');
}

/** Lit un fichier choisi par l'utilisateur comme texte (voir `decodeText`). */
export async function readTextFile(file: Blob): Promise<string> {
  void file;
  throw new Error('non implémenté');
}

/** Construit le fichier CSV à écrire / partager : UTF-8 avec BOM (pour Excel), type text/csv. */
export function csvFile(csv: string, filename: string): File {
  void csv; void filename;
  throw new Error('non implémenté');
}

/** Nom de fichier daté : `bacchus-cave-2026-11-16.csv`. */
export function datedFilename(date?: Date): string {
  void date;
  throw new Error('non implémenté');
}

/** Déclenche le téléchargement du CSV par le navigateur. */
export function downloadCsv(csv: string, filename: string): void {
  void csv; void filename;
  throw new Error('non implémenté');
}

/** Le navigateur sait-il partager un fichier CSV (Web Share API niveau 2) ? */
export function canShareCsv(): boolean {
  throw new Error('non implémenté');
}

/**
 * Ouvre la feuille de partage avec le CSV en pièce jointe (à appeler depuis un geste utilisateur).
 * `shared` : partage effectué ; `cancelled` : annulé par l'utilisateur ; `unsupported` : indisponible.
 */
export async function shareCsv(
  csv: string,
  filename: string,
  info: { title: string; text: string },
): Promise<'shared' | 'cancelled' | 'unsupported'> {
  void csv; void filename; void info;
  throw new Error('non implémenté');
}

/**
 * Construit un lien `mailto:` pour envoyer la cave par courriel. Le CSV est inséré dans le
 * corps du message s'il est assez court (`inline: true`) ; sinon le corps invite à joindre
 * le fichier téléchargé (`inline: false`).
 */
export function buildMailto(csv: string, info: { to?: string; subject: string; intro: string }): { href: string; inline: boolean } {
  void csv; void info;
  throw new Error('non implémenté');
}

/**
 * Extrait un CSV de cave d'un texte collé (par exemple le corps d'un courriel) :
 * retire le texte avant la ligne d'en-tête et après la dernière ligne de données.
 * Renvoie `null` si aucun en-tête n'est reconnu.
 */
export function extractCsvFromText(text: string): string | null {
  void text;
  throw new Error('non implémenté');
}
