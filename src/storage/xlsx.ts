/**
 * Lecture minimale d'un classeur Excel (.xlsx) : une feuille → texte CSV (séparateur « ; »).
 * Sert à reprendre une cave enregistrée depuis Excel au format classeur plutôt qu'en CSV.
 * Sans dépendance : archive ZIP lue à la main, décompression par `DecompressionStream`.
 */
import { looksLikeCellarCsv } from '../domain/csv';

const SIG_END = 0x06054b50;
const SIG_CENTRAL = 0x02014b50;

/** Le contenu commence-t-il comme une archive ZIP (donc un classeur .xlsx) ? */
export function isXlsx(bytes: Uint8Array): boolean {
  return bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('Ce navigateur ne sait pas lire les classeurs Excel : enregistrez la feuille au format CSV.');
  }
  const stream = new DecompressionStream('deflate-raw');
  const writer = stream.writable.getWriter();
  // Les erreurs d'écriture ressortent à la lecture ci-dessous.
  void writer.write(data as unknown as BufferSource).catch(() => undefined);
  void writer.close().catch(() => undefined);
  const reader = stream.readable.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = value as Uint8Array;
    chunks.push(chunk);
    total += chunk.length;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/** Extrait de l'archive les fichiers dont le nom est retenu par `wanted` (texte UTF-8). */
async function unzip(bytes: Uint8Array, wanted: (name: string) => boolean): Promise<Map<string, string>> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === SIG_END) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error('Classeur Excel illisible (archive incomplète).');
  const count = view.getUint16(end + 10, true);
  let p = view.getUint32(end + 16, true);
  const utf8 = new TextDecoder('utf-8');
  const files = new Map<string, string>();
  for (let n = 0; n < count; n++) {
    if (p + 46 > bytes.length || view.getUint32(p, true) !== SIG_CENTRAL) break;
    const method = view.getUint16(p + 10, true);
    const size = view.getUint32(p + 20, true);
    const nameLength = view.getUint16(p + 28, true);
    const local = view.getUint32(p + 42, true);
    const name = utf8.decode(bytes.subarray(p + 46, p + 46 + nameLength));
    p += 46 + nameLength + view.getUint16(p + 30, true) + view.getUint16(p + 32, true);
    if (!wanted(name)) continue;
    if (local + 30 > bytes.length) throw new Error('Classeur Excel illisible (archive endommagée).');
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const raw = bytes.subarray(start, start + size);
    if (method !== 0 && method !== 8) throw new Error('Classeur Excel illisible (compression inconnue).');
    files.set(name, utf8.decode(method === 0 ? raw : await inflateRaw(raw)));
  }
  return files;
}

const children = (parent: Element | Document, name: string): Element[] =>
  Array.from(parent.getElementsByTagNameNS('*', name));

/** Texte d'un élément « chaîne » (`<si>` ou `<is>`), sans les annotations phonétiques. */
function stringOf(element: Element): string {
  return children(element, 't')
    .filter((t) => t.parentElement?.localName !== 'rPh')
    .map((t) => t.textContent ?? '')
    .join('');
}

function parseXml(text: string): Document {
  return new DOMParser().parseFromString(text, 'application/xml');
}

/** « C12 » → 2 (colonne C, base 0) ; -1 si la référence est absente. */
function columnIndex(ref: string | null): number {
  const letters = /^[A-Za-z]+/.exec(ref ?? '')?.[0];
  if (!letters) return -1;
  let index = 0;
  for (const letter of letters.toUpperCase()) index = index * 26 + (letter.charCodeAt(0) - 64);
  return index - 1;
}

function sheetRows(xml: string, shared: readonly string[]): string[][] {
  const rows: string[][] = [];
  for (const row of children(parseXml(xml), 'row')) {
    const cells: string[] = [];
    let next = 0;
    for (const c of children(row, 'c')) {
      const at = columnIndex(c.getAttribute('r'));
      const index = at >= 0 ? at : next;
      next = index + 1;
      const type = c.getAttribute('t');
      const v = children(c, 'v')[0]?.textContent ?? '';
      let value: string;
      if (type === 's') value = shared[Number(v)] ?? '';
      else if (type === 'inlineStr') value = children(c, 'is')[0] ? stringOf(children(c, 'is')[0]!) : '';
      else if (type === 'b') value = v === '1' ? 'oui' : 'non';
      else value = /^-?\d+\.0+$/.test(v) ? v.replace(/\.0+$/, '') : v;
      while (cells.length < index) cells.push('');
      cells[index] = value;
    }
    if (cells.some((cell) => cell.trim() !== '')) rows.push(cells);
  }
  return rows;
}

const encode = (value: string): string =>
  /[";\r\n]/.test(value) || value !== value.trim() ? `"${value.replace(/"/g, '""')}"` : value;

/**
 * Convertit un classeur .xlsx en texte CSV : la première feuille qui ressemble à une cave,
 * à défaut la première feuille. Lève une erreur (en français) si le classeur est illisible.
 */
export async function xlsxToCsv(buffer: ArrayBuffer | Uint8Array): Promise<string> {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const files = await unzip(bytes, (name) => name === 'xl/sharedStrings.xml' || /^xl\/worksheets\/[^/]+\.xml$/.test(name));
  const sharedXml = files.get('xl/sharedStrings.xml');
  const shared = sharedXml ? children(parseXml(sharedXml), 'si').map(stringOf) : [];
  const sheets = [...files.keys()]
    .filter((name) => name !== 'xl/sharedStrings.xml')
    .sort((a, b) => a.localeCompare(b, 'fr', { numeric: true }));
  if (sheets.length === 0) throw new Error('Ce classeur Excel ne contient aucune feuille lisible.');
  let first: string | null = null;
  for (const name of sheets) {
    const rows = sheetRows(files.get(name) ?? '', shared);
    if (rows.length === 0) continue;
    const width = Math.max(...rows.map((row) => row.length));
    const csv = rows
      .map((row) => `${Array.from({ length: width }, (_, i) => encode(row[i] ?? '')).join(';')}\r\n`)
      .join('');
    if (looksLikeCellarCsv(csv)) return csv;
    first ??= csv;
  }
  if (first === null) throw new Error('Ce classeur Excel est vide.');
  return first;
}
