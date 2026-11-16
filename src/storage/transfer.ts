/**
 * Import / export du CSV sans File System Access API : téléchargement, partage
 * (feuille de partage iOS/Android/Windows : Mail, Fichiers, OneDrive…), courriel, lecture de fichier.
 */

const BOM = '﻿';
/** Longueur maximale d'un lien mailto: supportée de façon fiable par les clients de messagerie. */
const MAILTO_LIMIT = 1800;

/** Décode le contenu d'un fichier texte : UTF-8 (BOM retiré), UTF-16 avec BOM, repli Windows-1252. */
export function decodeText(bytes: ArrayBuffer | Uint8Array): string {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (data.length >= 2 && data[0] === 0xff && data[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(data.subarray(2));
  }
  if (data.length >= 2 && data[0] === 0xfe && data[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(data.subarray(2));
  }
  const body = data.length >= 3 && data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf ? data.subarray(3) : data;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(body);
  } catch {
    // Les CSV enregistrés par Excel en français sont souvent en Windows-1252.
    return new TextDecoder('windows-1252').decode(body);
  }
}

/** Lit un fichier choisi par l'utilisateur comme texte (voir `decodeText`). */
export async function readTextFile(file: Blob): Promise<string> {
  let buffer: ArrayBuffer;
  if (typeof file.arrayBuffer === 'function') {
    buffer = await file.arrayBuffer();
  } else {
    buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(new Error('Ce fichier n\'a pas pu être lu.'));
      reader.readAsArrayBuffer(file);
    });
  }
  return decodeText(buffer);
}

/** Construit le fichier CSV à écrire / partager : UTF-8 avec BOM (pour Excel), type text/csv. */
export function csvFile(csv: string, filename: string, type = 'text/csv'): File {
  return new File([BOM + csv], filename, { type });
}

/** Nom de fichier daté : `bacchus-cave-2026-11-16.csv` (date locale). */
export function datedFilename(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `bacchus-cave-${y}-${m}-${d}.csv`;
}

/** Déclenche le téléchargement du CSV par le navigateur. */
export function downloadCsv(csv: string, filename: string): void {
  const blob = new Blob([BOM + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Laisse au navigateur le temps de démarrer le téléchargement.
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

function shareableFile(csv: string, filename: string): File | null {
  if (typeof navigator === 'undefined' || typeof navigator.share !== 'function') return null;
  if (typeof navigator.canShare !== 'function' || typeof File === 'undefined') return null;
  try {
    const asCsv = csvFile(csv, filename);
    if (navigator.canShare({ files: [asCsv] })) return asCsv;
    // Certains navigateurs refusent text/csv mais acceptent le même fichier en texte brut.
    const asText = csvFile(csv, filename, 'text/plain');
    if (navigator.canShare({ files: [asText] })) return asText;
  } catch {
    /* API présente mais inutilisable */
  }
  return null;
}

/** Le navigateur sait-il partager un fichier CSV (Web Share API niveau 2) ? */
export function canShareCsv(): boolean {
  return shareableFile('a;b\r\n', 'bacchus-cave.csv') !== null;
}

/**
 * Ouvre la feuille de partage avec le CSV en pièce jointe (à appeler depuis un geste utilisateur).
 * `shared` : partage effectué ; `cancelled` : annulé par l'utilisateur ; `unsupported` : indisponible.
 * Seul le fichier est transmis : sur iOS, un texte d'accompagnement serait enregistré comme un second fichier.
 */
export async function shareCsv(
  csv: string,
  filename: string,
  _info?: { title: string; text: string },
): Promise<'shared' | 'cancelled' | 'unsupported'> {
  const file = shareableFile(csv, filename);
  if (!file) return 'unsupported';
  try {
    await navigator.share({ files: [file] });
    return 'shared';
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled';
    if (error && typeof error === 'object' && (error as { name?: string }).name === 'AbortError') return 'cancelled';
    return 'unsupported';
  }
}

/**
 * Construit un lien `mailto:` pour envoyer la cave par courriel. Le CSV est inséré dans le
 * corps du message s'il est assez court (`inline: true`) ; sinon le corps invite à joindre
 * le fichier téléchargé (`inline: false`).
 */
export function buildMailto(
  csv: string,
  info: { to?: string; subject: string; intro: string },
): { href: string; inline: boolean } {
  const crlf = (text: string): string => text.replace(/\r\n|\r|\n/g, '\r\n');
  const build = (body: string): string =>
    `mailto:${encodeURIComponent(info.to ?? '')}?subject=${encodeURIComponent(info.subject)}&body=${encodeURIComponent(crlf(body))}`;
  const inlineHref = build(
    `${info.intro}\r\n\r\n--- Cave (à copier dans Bacchus SmartCellar : Fichier > Coller un CSV) ---\r\n${csv.trim()}\r\n`,
  );
  if (inlineHref.length <= MAILTO_LIMIT) return { href: inlineHref, inline: true };
  return {
    href: build(
      `${info.intro}\r\n\r\nLe fichier de la cave (CSV) vient d'être téléchargé sur cet appareil : pensez à le joindre à ce message.\r\n`,
    ),
    inline: false,
  };
}

function headerSeparator(line: string): string | null {
  const lowered = line
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
  const looksLikeHeader =
    /^\W*enregistrement\b/.test(lowered) || (lowered.includes('chateau') && lowered.includes('appellation'));
  if (!looksLikeHeader) return null;
  for (const sep of [';', '\t', ',']) if (line.includes(sep)) return sep;
  return null;
}

/**
 * Extrait un CSV de cave d'un texte collé (par exemple le corps d'un courriel) :
 * retire le texte avant la ligne d'en-tête et après la dernière ligne de données.
 * Renvoie `null` si aucun en-tête n'est reconnu.
 */
export function extractCsvFromText(text: string): string | null {
  const lines = text
    .replace(/^﻿/, '')
    .split(/\r\n|\r|\n/)
    // Préfixes de citation des courriels (« > », « >> »).
    .map((line) => line.replace(/^\s*(?:>\s?)+/, ''));
  let start = -1;
  let sep = '';
  for (let i = 0; i < lines.length; i++) {
    const found = headerSeparator(lines[i]!);
    if (found) {
      start = i;
      sep = found;
      break;
    }
  }
  if (start < 0) return null;
  const kept: string[] = [lines[start]!.trim()];
  let pendingBlank = 0;
  let inQuotes = false;
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (inQuotes) {
      // Suite d'un champ entre guillemets contenant un retour à la ligne.
      kept.push(line);
      if ((line.match(/"/g)?.length ?? 0) % 2 === 1) inQuotes = false;
      continue;
    }
    if (line.trim() === '') {
      pendingBlank += 1;
      continue;
    }
    if (!line.includes(sep)) break;
    // Des lignes vides intercalées sont tolérées, pas un long blanc suivi d'autre chose.
    if (pendingBlank > 2) break;
    pendingBlank = 0;
    kept.push(line.trim());
    if ((line.match(/"/g)?.length ?? 0) % 2 === 1) inQuotes = true;
  }
  return kept.length > 1 ? kept.join('\r\n') : null;
}
