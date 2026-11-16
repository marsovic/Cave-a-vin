import { bottlesInReadingOrder, isCompatible, isValidYear, newBottleId } from './cellar';
import { FORME_LABELS, ROBE_LABELS, TYPE_CLAYETTE_LABELS, formatSlot, formatWine } from './labels';
import { joinCepages, norm, parseForme, parseRobe, parseTypeClayette, splitCepages } from './normalize';
import {
  SHELF_LIMITS,
  type Bottle,
  type Cellar,
  type Forme,
  type Robe,
  type Shelf,
  type SlotRef,
} from './types';

/**
 * Format du fichier CSV de DumbCellar (texte UTF-8, séparateur « ; »,
 * compatible Excel français). Une seule table, une ligne d'en-tête, puis :
 *  - une ligne `clayette` par clayette (configuration de la cave) ;
 *  - une ligne `bouteille` par bouteille.
 *
 * Colonnes (dans cet ordre à l'écriture ; ordre libre à la lecture) :
 *   type ; id ; capacite ; type_clayette ; nom ; appellation ; millesime ; cepages ;
 *   robe ; forme ; clayette ; place ; collection
 *
 * Exemple :
 *   type;id;capacite;type_clayette;nom;appellation;millesime;cepages;robe;forme;clayette;place;collection
 *   clayette;;13;bordeaux;;;;;;;1;;
 *   clayette;;10;champagne;;;;;;;2;;
 *   bouteille;5b4de640-…;;;Château Tayac;Margaux;1975;Cabernet Sauvignon, Merlot;Rouge;bordeaux;1;2;oui
 *   bouteille;8c1f02aa-…;;;Dom Pérignon;Champagne;;Chardonnay, Pinot noir;Blanc;champagne;2;1;non
 *
 * L'ancien format (`enregistrement;clayette;rang;emplacements;type;chateau;…;annee;…`)
 * reste lu : seuls les noms de colonnes diffèrent.
 */
export const CSV_COLUMNS = [
  'type',
  'id',
  'capacite',
  'type_clayette',
  'nom',
  'appellation',
  'millesime',
  'cepages',
  'robe',
  'forme',
  'clayette',
  'place',
  'collection',
] as const;

export const CSV_SEPARATOR = ';';
export const CSV_MIME = 'text/csv';
export const CSV_DEFAULT_FILENAME = 'dumbcellar.csv';

/** Colonnes telles que l'analyseur les manipule (indépendantes des noms d'en-tête du fichier). */
const COLUMNS = [
  'enregistrement',
  'id',
  'clayette',
  'rang',
  'emplacements',
  'type',
  'chateau',
  'appellation',
  'annee',
  'cepages',
  'robe',
  'forme',
  'collection',
] as const;

type Column = (typeof COLUMNS)[number];

/** Colonne du fichier → colonne interne. */
const FILE_COLUMN: Record<(typeof CSV_COLUMNS)[number], Column> = {
  type: 'enregistrement',
  id: 'id',
  capacite: 'emplacements',
  type_clayette: 'type',
  nom: 'chateau',
  appellation: 'appellation',
  millesime: 'annee',
  cepages: 'cepages',
  robe: 'robe',
  forme: 'forme',
  clayette: 'clayette',
  place: 'rang',
  collection: 'collection',
};

/* ------------------------------------------------------------------ */
/* Écriture                                                            */
/* ------------------------------------------------------------------ */

const EOL = '\r\n';
const RECORD_SHELF = 'clayette';
const RECORD_BOTTLE = 'bouteille';

/**
 * Valeur qu'un tableur prendrait pour une formule : `=`, `+`, `-` ou `@` en tête,
 * éventuellement après des espaces. Les apostrophes de tête sont comprises dans le
 * motif pour que la neutralisation reste réversible sans ambiguïté :
 * `=1+1` ↔ `'=1+1`, et une valeur qui vaut réellement `'=1+1` ↔ `''=1+1`.
 */
const FORMULA_START = /^'*\s*[=+\-@]/;
/** Valeur neutralisée par `FORMULA_START` : l'apostrophe de tête est à retirer. */
const FORMULA_NEUTRALIZED = /^'+\s*[=+\-@]/;
const NEEDS_QUOTES = /[";\r\n]/;

function encodeField(value: string): string {
  const v = FORMULA_START.test(value) ? `'${value}` : value;
  // `trim()` est aussi ce que la lecture applique aux champs sans guillemets.
  return v !== v.trim() || NEEDS_QUOTES.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

function encodeRow(values: Partial<Record<Column, string>>): string {
  return CSV_COLUMNS.map((col) => encodeField(values[FILE_COLUMN[col]] ?? '')).join(CSV_SEPARATOR);
}

/**
 * Sérialise la cave en CSV. Lignes séparées par CRLF, champs entourés de guillemets
 * si nécessaire (séparateur, guillemet, retour à la ligne, espaces en bord), guillemets
 * doublés. Clayettes dans l'ordre, puis bouteilles dans l'ordre de lecture.
 * Les valeurs commençant par `=`, `+`, `-`, `@` sont préfixées d'une apostrophe pour
 * neutraliser l'injection de formules dans un tableur (et l'apostrophe est retirée à la lecture).
 * Pas de BOM dans la chaîne renvoyée (il est ajouté à l'écriture du fichier).
 *
 * Chaque ligne, y compris la dernière, est terminée par CRLF.
 */
export function serializeCellar(cellar: Cellar): string {
  const lines: string[] = [CSV_COLUMNS.join(CSV_SEPARATOR)];
  cellar.shelves.forEach((shelf, i) => {
    lines.push(
      encodeRow({
        enregistrement: RECORD_SHELF,
        clayette: String(i + 1),
        emplacements: String(shelf.capacite),
        type: shelf.type,
      }),
    );
  });
  for (const b of bottlesInReadingOrder(cellar)) {
    lines.push(
      encodeRow({
        enregistrement: RECORD_BOTTLE,
        id: b.id,
        clayette: String(b.clayette),
        rang: String(b.rang),
        chateau: b.chateau,
        appellation: b.appellation,
        annee: b.annee === null ? '' : String(b.annee),
        cepages: joinCepages(b.cepages),
        robe: ROBE_LABELS[b.robe],
        forme: b.forme,
        collection: b.collection ? 'oui' : 'non',
      }),
    );
  }
  return lines.map((line) => line + EOL).join('');
}

/* ------------------------------------------------------------------ */
/* Lecture : analyseur CSV                                             */
/* ------------------------------------------------------------------ */

interface CsvRow {
  /** N° de la ligne du fichier (base 1) où commence l'enregistrement. */
  line: number;
  cells: string[];
}

interface CsvRows {
  rows: CsvRow[];
  /** Ligne d'un guillemet ouvert jamais refermé, le cas échéant. */
  unclosedQuoteLine: number | null;
}

const CC_TAB = 9;
const CC_LF = 10;
const CC_CR = 13;
const CC_SPACE = 32;
const CC_QUOTE = 34;
const CC_HASH = 35;

/**
 * Découpe un texte CSV en enregistrements.
 *  - champ entre guillemets : contenu repris tel quel (séparateurs, retours à la ligne,
 *    espaces), `""` valant un guillemet ; un guillemet au milieu d'un champ nu est littéral ;
 *  - champ nu : espaces de bord retirés ;
 *  - fins de ligne CRLF, LF ou CR ; lignes vides et lignes `#commentaire` écartées ;
 *  - l'apostrophe de neutralisation des formules est retirée.
 */
function readRows(text: string, sep: string, firstLine = 1): CsvRows {
  const sepCode = sep.charCodeAt(0);
  const n = text.length;
  const rows: CsvRow[] = [];
  let unclosedQuoteLine: number | null = null;
  let i = 0;
  let line = firstLine;

  const isBlank = (code: number): boolean => code === CC_SPACE || (code === CC_TAB && sepCode !== CC_TAB);
  const isEol = (code: number): boolean => code === CC_LF || code === CC_CR;
  /** Position qui suit la fin de ligne située en `p`. */
  const afterEol = (p: number): number =>
    text.charCodeAt(p) === CC_CR && text.charCodeAt(p + 1) === CC_LF ? p + 2 : p + 1;

  while (i < n) {
    const startLine = line;

    let p = i;
    while (p < n && isBlank(text.charCodeAt(p))) p++;
    if (p < n && text.charCodeAt(p) === CC_HASH) {
      // Ligne de commentaire : ignorée jusqu'à la fin de la ligne — sauf si elle contient le
      // séparateur : c'est alors une ligne de données dont la première cellule commence par « # »
      // (« #1 Cuvée;Margaux;2015 »), qu'il ne faut pas faire disparaître en silence.
      let q = p;
      let hasSeparator = false;
      while (q < n && !isEol(text.charCodeAt(q))) {
        if (text.charCodeAt(q) === sepCode) hasSeparator = true;
        q++;
      }
      if (!hasSeparator) {
        i = q < n ? afterEol(q) : n;
        line++;
        continue;
      }
    }

    const cells: string[] = [];
    for (;;) {
      p = i;
      while (p < n && isBlank(text.charCodeAt(p))) p++;
      let value: string;
      if (p < n && text.charCodeAt(p) === CC_QUOTE) {
        p++;
        let content = '';
        let segment = p;
        let closed = false;
        while (p < n) {
          const code = text.charCodeAt(p);
          if (code === CC_QUOTE) {
            if (text.charCodeAt(p + 1) === CC_QUOTE) {
              content += text.slice(segment, p + 1);
              p += 2;
              segment = p;
              continue;
            }
            content += text.slice(segment, p);
            closed = true;
            p++;
            break;
          }
          if (code === CC_LF || (code === CC_CR && text.charCodeAt(p + 1) !== CC_LF)) line++;
          p++;
        }
        if (!closed) {
          content += text.slice(segment, n);
          unclosedQuoteLine ??= startLine;
        }
        // Texte éventuel entre le guillemet fermant et le séparateur : toléré, accolé à la valeur.
        const tailStart = p;
        while (p < n) {
          const code = text.charCodeAt(p);
          if (code === sepCode || isEol(code)) break;
          p++;
        }
        const tail = text.slice(tailStart, p);
        value = tail.trim() === '' ? content : content + tail.trimEnd();
      } else {
        p = i;
        while (p < n) {
          const code = text.charCodeAt(p);
          if (code === sepCode || isEol(code)) break;
          p++;
        }
        value = text.slice(i, p).trim();
      }
      cells.push(FORMULA_NEUTRALIZED.test(value) ? value.slice(1) : value);

      if (p >= n) {
        i = n;
        break;
      }
      if (text.charCodeAt(p) === sepCode) {
        i = p + 1;
        if (i >= n) {
          cells.push('');
          break;
        }
        continue;
      }
      i = afterEol(p);
      line++;
      break;
    }
    if (cells.some((c) => c !== '')) rows.push({ line: startLine, cells });
  }
  return { rows, unclosedQuoteLine };
}

/* ------------------------------------------------------------------ */
/* Lecture : en-tête                                                   */
/* ------------------------------------------------------------------ */

/** Alias d'en-têtes, déjà normalisés par `norm` (minuscules, sans accents ni ponctuation). */
const HEADER_ALIASES: Record<Column, readonly string[]> = {
  enregistrement: ['enregistrement', 'type enregistrement', 'type d enregistrement', 'type de ligne', 'record'],
  id: ['id', 'identifiant', 'uuid', 'guid'],
  clayette: ['clayette', 'etagere', 'etage', 'tablette', 'niveau', 'shelf'],
  rang: ['rang', 'place', 'position', 'pos', 'colonne', 'slot'],
  emplacements: [
    'emplacements',
    'nombre d emplacements',
    'nombre emplacements',
    'nb emplacements',
    'nbre emplacements',
    'capacite',
    'places',
    'nombre de places',
    'nb places',
    'capacity',
  ],
  type: [
    'type',
    'type clayette',
    'type de clayette',
    'type d emplacement',
    'type d emplacements',
    'type emplacements',
  ],
  chateau: [
    'chateau',
    'domaine',
    'producteur',
    'nom',
    'vin',
    'nom du vin',
    'chateau domaine',
    'domaine chateau',
    'chateau ou domaine',
    'chateau domaine producteur',
    'propriete',
    'winery',
    'producer',
    'name',
    'wine',
  ],
  appellation: ['appellation', 'appellations', 'aoc', 'a o c', 'aop', 'a o p', 'denomination', 'appellation d origine'],
  annee: ['annee', 'millesime', 'an', 'annee millesime', 'year', 'vintage'],
  cepages: ['cepages', 'cepage', 'cepage s', 'encepagement', 'cepages principaux', 'grapes'],
  robe: ['robe', 'couleur', 'type de vin', 'type vin', 'color', 'colour'],
  forme: [
    'forme',
    'forme bouteille',
    'forme de bouteille',
    'forme de la bouteille',
    'type de bouteille',
    'type bouteille',
    'shape',
  ],
  collection: ['collection', 'de collection', 'bouteille de collection', 'collector'],
};

const ALIAS_INDEX: ReadonlyMap<string, Column> = new Map(
  COLUMNS.flatMap((col) => HEADER_ALIASES[col].map((alias): [string, Column] => [alias, col])),
);

/** « n° clayette », « numéro de rang », « no étagère »… → « clayette », « rang », « etagere ». */
const NUMBER_PREFIX = /^(?:n|no|nr|num|numero)(?: de| du| d)? (?=\S)/;

function columnOf(headerCell: string): Column | null {
  const key = norm(headerCell);
  if (!key) return null;
  return ALIAS_INDEX.get(key) ?? ALIAS_INDEX.get(key.replace(NUMBER_PREFIX, '')) ?? null;
}

interface HeaderMap {
  /** Colonne du format → indices des colonnes du fichier qui la portent (ordre du fichier). */
  columns: Map<Column, number[]>;
  /** En-têtes non reconnus, tels qu'écrits dans le fichier. */
  unknown: string[];
  width: number;
}

function analyzeHeader(cells: readonly string[]): HeaderMap {
  const columns = new Map<Column, number[]>();
  const unknown: string[] = [];
  cells.forEach((cell, index) => {
    const col = columnOf(cell);
    if (col) {
      const list = columns.get(col);
      if (list) list.push(index);
      else columns.set(col, [index]);
    } else if (cell.trim() !== '') {
      unknown.push(cell.trim());
    }
  });
  // « type » seul désigne le type d'enregistrement (clayette / bouteille) dès qu'une autre
  // colonne porte le type de clayette (« type_clayette ») — c'est le format d'origine.
  const types = columns.get('type');
  if (types && types.length > 1 && !columns.has('enregistrement')) {
    const bare = types.filter((index) => norm(cells[index] ?? '') === 'type');
    if (bare.length > 0 && bare.length < types.length) {
      columns.set('enregistrement', bare);
      columns.set(
        'type',
        types.filter((index) => !bare.includes(index)),
      );
    }
  }
  return { columns, unknown, width: cells.length };
}

/** Un en-tête est exploitable s'il permet de décrire au moins une bouteille ou une clayette. */
function isUsefulHeader(header: HeaderMap): boolean {
  const { columns } = header;
  return (
    columns.has('chateau') || columns.has('appellation') || columns.has('emplacements') || columns.has('enregistrement')
  );
}

interface LocatedHeader {
  /** Position, dans le texte, du début de la ligne d'en-tête. */
  offset: number;
  /** N° de cette ligne (base 1). */
  line: number;
  sep: string;
  header: HeaderMap;
}

const SEPARATOR_CANDIDATES = [';', '\t', ','] as const;
/** Indication « sep=; » qu'Excel accepte en première ligne. */
const SEP_DIRECTIVE = /^ *sep=([^\s"]|\t) *$/i;
/** Ligne ne contenant que des séparateurs, des espaces ou des guillemets : considérée comme vide. */
const EMPTY_LINE = /^[\s;,"]*$/;

/**
 * Repère la ligne d'en-tête (première ligne ni vide ni commentaire) et son séparateur :
 * celui qui fait reconnaître le plus de colonnes, à défaut celui qui en produit le plus.
 */
function locateHeader(text: string): LocatedHeader | null {
  const n = text.length;
  let pos = 0;
  let line = 1;
  let forced: string | null = null;
  while (pos < n) {
    let end = pos;
    while (end < n && text.charCodeAt(end) !== CC_LF && text.charCodeAt(end) !== CC_CR) end++;
    const raw = text.slice(pos, end);
    const next = text.charCodeAt(end) === CC_CR && text.charCodeAt(end + 1) === CC_LF ? end + 2 : end + 1;
    const directive: RegExpExecArray | null = forced === null ? SEP_DIRECTIVE.exec(raw) : null;
    if (directive) {
      forced = directive[1] ?? null;
    } else if (!EMPTY_LINE.test(raw) && !raw.trimStart().startsWith('#')) {
      let best: { sep: string; header: HeaderMap } | null = null;
      for (const sep of forced === null ? SEPARATOR_CANDIDATES : [forced]) {
        const header = analyzeHeader(readRows(raw, sep).rows[0]?.cells ?? []);
        if (
          best === null ||
          header.columns.size > best.header.columns.size ||
          (header.columns.size === best.header.columns.size && header.width > best.header.width)
        ) {
          best = { sep, header };
        }
      }
      return best && { offset: pos, line, sep: best.sep, header: best.header };
    }
    pos = next;
    line++;
  }
  return null;
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * Le texte commence-t-il par un en-tête de cave reconnu ? Sert à repérer un CSV dans un
 * texte collé (corps de courriel, cellules copiées d'un tableur…).
 *
 * Vrai si la première ligne significative (ni vide, ni `#commentaire`, ni indication
 * `sep=;`) contient au moins deux colonnes reconnues, dont une colonne utile (château,
 * appellation, emplacements ou enregistrement), quel que soit le séparateur (`;`, `,`,
 * tabulation). Tout texte accepté ici a un en-tête que `parseCellarCsv` reconnaît ;
 * l'inverse n'est pas vrai pour un en-tête d'une seule colonne, trop ambigu dans un texte libre.
 */
export function looksLikeCellarCsv(text: string): boolean {
  const located = locateHeader(stripBom(text));
  return located !== null && located.header.columns.size >= 2 && isUsefulHeader(located.header);
}

/**
 * Si `line` est une ligne d'en-tête de cave reconnue (voir `looksLikeCellarCsv`), renvoie son
 * séparateur ; sinon `null`. Sert à repérer le début d'un tableau dans un texte collé.
 */
export function cellarHeaderSeparator(line: string): string | null {
  if (/[\r\n]/.test(line.trim())) return null;
  const located = locateHeader(stripBom(line));
  if (located === null || located.header.columns.size < 2 || !isUsefulHeader(located.header)) return null;
  return located.sep;
}

/* ------------------------------------------------------------------ */
/* Lecture : valeurs                                                   */
/* ------------------------------------------------------------------ */

const RECORD_SHELF_WORDS = new Set(['clayette', 'clayettes', 'etagere', 'shelf', 'c']);
const RECORD_BOTTLE_WORDS = new Set(['bouteille', 'bouteilles', 'vin', 'bottle', 'b']);

const NO_VINTAGE_WORDS = new Set([
  'nm',
  'nv',
  'sa',
  'bsa',
  'sans',
  'sans annee',
  'sans millesime',
  'non millesime',
  'non millesimee',
  'aucun',
  'aucune',
  'inconnu',
  'inconnue',
  'na',
  'n a',
  'vide',
]);

const TRUE_WORDS = new Set(['oui', 'o', 'true', '1', 'x', 'vrai', 'v', 'yes', 'y', 'collection', 'de collection']);
const FALSE_WORDS = new Set(['non', 'n', 'false', '0', 'faux', 'f', 'no']);

/** Entier écrit « 3 », « 03 », « 3.0 » ou « 3,0 » ; `null` si vide, `NaN` si illisible. */
function parseIntCell(text: string): number | null {
  if (!text) return null;
  const m = /^([+-]?\d{1,9})(?:[.,]0*)?$/.exec(text);
  return m ? Number(m[1]) : Number.NaN;
}

/** Millésime : « 2015 », « 2015.0 » ; vide, « NM », « sans »… → `null` ; `NaN` si invalide. */
function parseAnnee(text: string): number | null {
  if (!text) return null;
  const key = norm(text);
  // Une valeur faite de seule ponctuation (« - », « ? »…) vaut « pas de millésime ».
  if (!key || NO_VINTAGE_WORDS.has(key)) return null;
  const m = /^(\d{1,9})(?:[.,]0*)?$/.exec(text);
  const annee = m ? Number(m[1]) : Number.NaN;
  return isValidYear(annee) ? annee : Number.NaN;
}

/** `collection` : oui/non, o/n, true/false, 1/0, x, vrai/faux… ; `null` si incompris. */
function parseCollection(text: string): boolean | null {
  if (!text) return false;
  if (/[✓✔☑]/.test(text)) return true;
  const key = norm(text);
  if (TRUE_WORDS.has(key)) return true;
  // Une valeur faite de seule ponctuation (« - », « . »…) vaut « non ».
  if (FALSE_WORDS.has(key) || key === '') return false;
  return null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count > 1 ? 's' : ''}`;
}

/* ------------------------------------------------------------------ */
/* Lecture : cave                                                      */
/* ------------------------------------------------------------------ */

export interface CsvImportResult {
  /** La cave lue, ou `null` si le fichier est inexploitable. */
  cellar: Cellar | null;
  /** Erreurs bloquantes (français, affichables). Si non vide, `cellar` est `null`. */
  errors: string[];
  /** Anomalies non bloquantes : lignes ignorées, valeurs corrigées, configuration déduite… */
  warnings: string[];
  /** Nombre de bouteilles et de clayettes lues. */
  stats: { bouteilles: number; clayettes: number; lignesIgnorees: number };
}

interface ShelfDraft {
  line: number;
  numero: number;
  shelf: Shelf;
}

interface BottleDraft {
  /** Rang de la bouteille dans le fichier (base 0). */
  index: number;
  line: number;
  /** Identifiant lu dans le fichier (`''` si absent). */
  id: string;
  chateau: string;
  appellation: string;
  annee: number | null;
  cepages: string[];
  robe: Robe;
  /** Forme lue ; `null` si absente ou incomprise (déduite ensuite de la clayette). */
  forme: Forme | null;
  /** Texte de forme incompris, pour l'avertissement. */
  formeText: string;
  collection: boolean;
  /** Position lue (entiers ≥ 1), ou `null` si absente / illisible. */
  slot: SlotRef | null;
  /** Pourquoi `slot` est `null`. */
  slotIssue: string;
}

/**
 * Lit un CSV de cave. Lecture tolérante :
 *  - BOM UTF-8 ignoré ; fins de ligne CRLF / LF / CR ; lignes vides et lignes `#commentaire` ignorées ;
 *  - séparateur détecté automatiquement (`;`, `,` ou tabulation) sur la ligne d'en-tête ;
 *  - en-têtes insensibles à la casse et aux accents, avec alias (ex. « château », « domaine »,
 *    « millésime », « année », « couleur », « cépage(s) », « n° clayette », « étagère », « position »…) ;
 *  - colonne `enregistrement` facultative : sans elle, toute ligne ayant un château ou une
 *    appellation est une bouteille ;
 *  - valeurs de robe / forme / type interprétées souplement (voir `parseRobe`, `parseForme`,
 *    `parseTypeClayette`) ; `collection` : oui/non, o/n, true/false, 1/0, x, vrai/faux ;
 *  - si le fichier ne contient aucune ligne `clayette`, la configuration est déduite :
 *    autant de clayettes que le plus grand n° rencontré (au moins la valeur par défaut),
 *    capacité = max(rang rencontré, capacité par défaut), type « tout » (+ avertissement) ;
 *  - une bouteille sans position, hors cave, sur un emplacement déjà pris ou incompatible
 *    est replacée sur le premier emplacement libre compatible (+ avertissement) ; s'il n'y en
 *    a pas, elle est ignorée (+ avertissement) ;
 *  - une forme absente est déduite du type de la clayette si celle-ci est spécialisée, sinon « bordeaux » ;
 *    une robe absente vaut « rouge » (+ avertissement).
 * Erreurs bloquantes : fichier vide, en-tête non reconnu (aucune colonne utile), aucune donnée.
 * Le résultat respecte toujours les invariants de `validateCellar`.
 *
 * Précisions :
 *  - les avertissements sont préfixés « Ligne N : » (n° de ligne du fichier, en-tête comprise) et
 *    triés par ligne ; une colonne entièrement absente (forme, robe, position) donne un seul
 *    avertissement global au lieu d'un par bouteille ;
 *  - les bouteilles bien placées gardent leur emplacement ; les autres sont replacées ensuite,
 *    dans l'ordre du fichier ; les bouteilles sont renvoyées dans l'ordre du fichier ;
 *  - une ligne `bouteille` sans château ni appellation est ignorée (+ avertissement) ;
 *  - une indication `sep=;` en première ligne (convention Excel) est acceptée.
 */
export function parseCellarCsv(text: string): CsvImportResult {
  const notes: { line: number; message: string }[] = [];
  let lignesIgnorees = 0;
  /** `line` = 0 pour une remarque qui concerne tout le fichier. */
  const warn = (line: number, message: string): void => {
    notes.push({ line, message: line > 0 ? `Ligne ${line} : ${message}` : message });
  };
  const ignore = (line: number, message: string): void => {
    lignesIgnorees += 1;
    warn(line, message);
  };
  const warnings = (): string[] => [...notes].sort((a, b) => a.line - b.line).map((note) => note.message);
  const failure = (error: string): CsvImportResult => ({
    cellar: null,
    errors: [error],
    warnings: warnings(),
    stats: { bouteilles: 0, clayettes: 0, lignesIgnorees },
  });

  /* --- En-tête ---------------------------------------------------- */

  const content = stripBom(text);
  const located = locateHeader(content);
  if (!located) return failure('Le fichier est vide.');

  const { rows, unclosedQuoteLine } = readRows(content.slice(located.offset), located.sep, located.line);
  const headerRow = rows[0];
  if (!headerRow) return failure('Le fichier est vide.');
  const header = analyzeHeader(headerRow.cells);
  if (!isUsefulHeader(header)) {
    const seen = headerRow.cells.filter((c) => c.trim() !== '');
    const shown = seen
      .slice(0, 5)
      .map((c) => `« ${c.length > 30 ? `${c.slice(0, 30)}…` : c} »`)
      .join(', ');
    return failure(
      `En-tête non reconnu : la ligne ${headerRow.line} (${shown}${seen.length > 5 ? '…' : ''}) ne nomme aucune colonne utile. ` +
        `Colonnes attendues : ${CSV_COLUMNS.join(' ; ')}.`,
    );
  }
  const { columns } = header;
  const dataRows = rows.slice(1);

  // Colonne « type » sans « type_clayette » : c'est le type d'enregistrement si elle ne
  // contient que « clayette » / « bouteille ».
  const typeOnly = columns.get('type');
  if (typeOnly && !columns.has('enregistrement')) {
    const values = dataRows.flatMap((row) =>
      typeOnly.map((index) => norm(row.cells[index] ?? '')).filter((value) => value !== ''),
    );
    if (values.length > 0 && values.every((v) => RECORD_SHELF_WORDS.has(v) || RECORD_BOTTLE_WORDS.has(v))) {
      columns.set('enregistrement', typeOnly);
      columns.delete('type');
    }
  }

  if (header.unknown.length > 0) {
    const names = header.unknown.map((name) => `« ${name} »`).join(', ');
    warn(
      0,
      header.unknown.length > 1
        ? `Colonnes non reconnues, ignorées : ${names}.`
        : `Colonne non reconnue, ignorée : ${names}.`,
    );
  }
  for (const [col, indices] of columns) {
    if (indices.length > 1) {
      const names = indices.map((index) => `« ${headerRow.cells[index]?.trim() ?? ''} »`).join(', ');
      warn(
        0,
        `Les colonnes ${names} désignent toutes « ${col} » : pour chaque ligne, la première valeur non vide est utilisée.`,
      );
    }
  }
  if (unclosedQuoteLine !== null) {
    warn(
      unclosedQuoteLine,
      'guillemet ouvert jamais refermé — toute la fin du fichier a été lue comme une seule valeur.',
    );
  }

  /** Valeur d'une colonne du format pour une ligne (telle qu'écrite ; `''` si absente). */
  const cell = (row: CsvRow, col: Column): string => {
    const indices = columns.get(col);
    if (!indices) return '';
    for (const index of indices) {
      const value = row.cells[index];
      if (value !== undefined && value !== '') return value;
    }
    return '';
  };

  /* --- Lignes ----------------------------------------------------- */

  const shelfDrafts: ShelfDraft[] = [];
  const shelfLines = new Map<number, number>();
  const bottleDrafts: BottleDraft[] = [];
  let highestShelf = 0;

  const readShelf = (row: CsvRow): void => {
    const numeroText = cell(row, 'clayette').trim();
    let numero = parseIntCell(numeroText);
    if (numero === null) {
      numero = highestShelf + 1;
      warn(row.line, `n° de clayette absent — clayette numérotée ${numero} d'après l'ordre du fichier.`);
    }
    if (Number.isNaN(numero) || numero < 1) {
      ignore(row.line, `n° de clayette « ${numeroText} » illisible — ligne ignorée.`);
      return;
    }
    if (numero > SHELF_LIMITS.maxShelves) {
      ignore(
        row.line,
        `clayette n° ${numero} au-delà de la limite de ${SHELF_LIMITS.maxShelves} clayettes — ligne ignorée.`,
      );
      return;
    }
    const firstLine = shelfLines.get(numero);
    if (firstLine !== undefined) {
      ignore(row.line, `la clayette n° ${numero} est déjà décrite ligne ${firstLine} — ligne ignorée.`);
      return;
    }

    const capaciteText = cell(row, 'emplacements').trim();
    let capacite = parseIntCell(capaciteText);
    if (capacite === null) {
      capacite = SHELF_LIMITS.defaultCapacity;
      warn(row.line, `clayette ${numero} — nombre d'emplacements absent : ${capacite} par défaut.`);
    } else if (Number.isNaN(capacite)) {
      capacite = SHELF_LIMITS.defaultCapacity;
      warn(
        row.line,
        `clayette ${numero} — nombre d'emplacements « ${capaciteText} » illisible : ${capacite} par défaut.`,
      );
    } else if (capacite > SHELF_LIMITS.maxCapacity) {
      warn(
        row.line,
        `clayette ${numero} — ${capacite} emplacements demandés, maximum ${SHELF_LIMITS.maxCapacity} : valeur ramenée à ${SHELF_LIMITS.maxCapacity}.`,
      );
      capacite = SHELF_LIMITS.maxCapacity;
    } else if (capacite < SHELF_LIMITS.minCapacity) {
      warn(
        row.line,
        `clayette ${numero} — ${capacite} emplacement demandé, minimum ${SHELF_LIMITS.minCapacity} : valeur ramenée à ${SHELF_LIMITS.minCapacity}.`,
      );
      capacite = SHELF_LIMITS.minCapacity;
    }

    const typeText = cell(row, 'type').trim();
    let type = parseTypeClayette(typeText);
    if (type === null) {
      type = 'tout';
      if (typeText) {
        warn(
          row.line,
          `clayette ${numero} — type « ${typeText} » non reconnu : « ${TYPE_CLAYETTE_LABELS.tout} » par défaut.`,
        );
      }
    }

    shelfLines.set(numero, row.line);
    highestShelf = Math.max(highestShelf, numero);
    shelfDrafts.push({ line: row.line, numero, shelf: { capacite, type } });
  };

  const readBottle = (row: CsvRow, chateau: string, appellation: string): void => {
    const anneeText = cell(row, 'annee').trim();
    let annee = parseAnnee(anneeText);
    const anneeInvalide = annee !== null && Number.isNaN(annee);
    if (anneeInvalide) annee = null;
    const nom = formatWine({ chateau, appellation, annee });
    if (anneeInvalide) warn(row.line, `année « ${anneeText} » invalide — ${nom} est enregistrée sans millésime.`);

    const robeText = cell(row, 'robe').trim();
    let robe = parseRobe(robeText);
    if (robe === null) {
      robe = 'rouge';
      // Colonne absente : un seul avertissement global, émis plus bas.
      if (columns.has('robe')) {
        warn(
          row.line,
          robeText
            ? `robe « ${robeText} » non reconnue — ${nom} est enregistrée en « ${ROBE_LABELS.rouge} ».`
            : `robe absente — ${nom} est enregistrée en « ${ROBE_LABELS.rouge} ».`,
        );
      }
    }

    const formeText = cell(row, 'forme').trim();
    const forme = parseForme(formeText);

    const collectionText = cell(row, 'collection').trim();
    let collection = parseCollection(collectionText);
    if (collection === null) {
      collection = false;
      warn(
        row.line,
        `valeur « ${collectionText} » non comprise dans la colonne « collection » (attendu : oui ou non) — ${nom} n'est pas marquée « collection ».`,
      );
    }

    const clayetteText = cell(row, 'clayette').trim();
    const rangText = cell(row, 'rang').trim();
    const clayette = parseIntCell(clayetteText);
    const rang = parseIntCell(rangText);
    let slot: SlotRef | null = null;
    let slotIssue = '';
    if (clayette === null && rang === null) {
      slotIssue = 'position absente';
    } else if (clayette === null || rang === null || !(clayette >= 1) || !(rang >= 1)) {
      const lu = (value: string): string => (value ? `« ${value} »` : 'absent');
      slotIssue = `position incomplète ou illisible (clayette ${lu(clayetteText)}, rang ${lu(rangText)})`;
    } else {
      slot = { clayette, rang };
    }

    bottleDrafts.push({
      index: bottleDrafts.length,
      line: row.line,
      id: cell(row, 'id').trim(),
      chateau,
      appellation,
      annee,
      cepages: splitCepages(cell(row, 'cepages')),
      robe,
      forme,
      formeText,
      collection,
      slot,
      slotIssue,
    });
  };

  for (const row of dataRows) {
    if (row.cells.length > header.width && row.cells.slice(header.width).some((c) => c.trim() !== '')) {
      warn(
        row.line,
        `${row.cells.length} valeurs pour ${plural(header.width, 'colonne')} — les valeurs en trop sont ignorées (un séparateur dans une valeur sans guillemets ?).`,
      );
    }
    const chateau = cell(row, 'chateau');
    const appellation = cell(row, 'appellation');
    const named = chateau.trim() !== '' || appellation.trim() !== '';

    const recordText = cell(row, 'enregistrement').trim();
    if (recordText) {
      const key = norm(recordText);
      if (RECORD_SHELF_WORDS.has(key)) {
        readShelf(row);
      } else if (!RECORD_BOTTLE_WORDS.has(key)) {
        ignore(
          row.line,
          `enregistrement « ${recordText} » inconnu (attendu : « ${RECORD_SHELF} » ou « ${RECORD_BOTTLE} ») — ligne ignorée.`,
        );
      } else if (named) {
        readBottle(row, chateau, appellation);
      } else {
        ignore(row.line, 'bouteille sans château ni appellation — ligne ignorée.');
      }
    } else if (named) {
      readBottle(row, chateau, appellation);
    } else if (cell(row, 'emplacements').trim() !== '' || cell(row, 'type').trim() !== '') {
      readShelf(row);
    } else {
      ignore(row.line, 'ni château ni appellation — ligne ignorée.');
    }
  }

  if (shelfDrafts.length === 0 && bottleDrafts.length === 0) {
    return failure(
      lignesIgnorees > 0
        ? `Le fichier ne contient aucune donnée exploitable : ${plural(lignesIgnorees, 'ligne')} ${lignesIgnorees > 1 ? 'ignorées' : 'ignorée'} (voir les avertissements).`
        : "Le fichier ne contient aucune donnée : ni clayette ni bouteille après la ligne d'en-tête.",
    );
  }

  /* --- Configuration des clayettes --------------------------------- */

  const shelves: Shelf[] = [];
  if (shelfDrafts.length > 0) {
    const byNumero = new Map(shelfDrafts.map((draft) => [draft.numero, draft.shelf]));
    for (let numero = 1; numero <= highestShelf; numero++) {
      const shelf = byNumero.get(numero);
      if (shelf) {
        shelves.push(shelf);
      } else {
        shelves.push({ capacite: SHELF_LIMITS.defaultCapacity, type: 'tout' });
        warn(
          0,
          `Clayette ${numero} non décrite dans le fichier : ${SHELF_LIMITS.defaultCapacity} emplacements « ${TYPE_CLAYETTE_LABELS.tout} » par défaut.`,
        );
      }
    }
  } else {
    let maxClayette = 0;
    let maxRang = 0;
    for (const draft of bottleDrafts) {
      if (!draft.slot) continue;
      maxClayette = Math.max(maxClayette, draft.slot.clayette);
      maxRang = Math.max(maxRang, draft.slot.rang);
    }
    const count = clamp(
      Math.max(maxClayette, SHELF_LIMITS.defaultShelves),
      SHELF_LIMITS.minShelves,
      SHELF_LIMITS.maxShelves,
    );
    const capacite = clamp(
      Math.max(maxRang, SHELF_LIMITS.defaultCapacity),
      SHELF_LIMITS.minCapacity,
      SHELF_LIMITS.maxCapacity,
    );
    for (let k = 0; k < count; k++) shelves.push({ capacite, type: 'tout' });
    warn(
      0,
      `Aucune ligne « ${RECORD_SHELF} » dans le fichier : configuration déduite des bouteilles (${plural(count, 'clayette')} de ${plural(capacite, 'emplacement')}, type « ${TYPE_CLAYETTE_LABELS.tout} »).`,
    );
    if (maxClayette > SHELF_LIMITS.maxShelves) {
      warn(
        0,
        `Le fichier mentionne la clayette n° ${maxClayette}, mais une cave est limitée à ${SHELF_LIMITS.maxShelves} clayettes : les bouteilles au-delà sont replacées.`,
      );
    }
    if (maxRang > SHELF_LIMITS.maxCapacity) {
      warn(
        0,
        `Le fichier mentionne le rang n° ${maxRang}, mais une clayette est limitée à ${SHELF_LIMITS.maxCapacity} emplacements : les bouteilles au-delà sont replacées.`,
      );
    }
  }

  /* --- Avertissements globaux sur les colonnes absentes ------------- */

  const positionColumns = columns.has('clayette') && columns.has('rang');
  if (bottleDrafts.length > 0) {
    if (!positionColumns) {
      const missing = (['clayette', 'rang'] as const).filter((col) => !columns.has(col)).map((col) => `« ${col} »`);
      warn(
        0,
        `${missing.length > 1 ? 'Colonnes' : 'Colonne'} ${missing.join(' et ')} ${missing.length > 1 ? 'absentes' : 'absente'} : les bouteilles sont rangées dans l'ordre du fichier, sur les premiers emplacements libres compatibles.`,
      );
    }
    if (!columns.has('robe')) {
      warn(0, `Colonne « robe » absente : toutes les bouteilles sont enregistrées en « ${ROBE_LABELS.rouge} ».`);
    }
    if (!columns.has('forme')) {
      warn(
        0,
        `Colonne « forme » absente : forme déduite du type de la clayette si elle est spécialisée, sinon « ${FORME_LABELS.bordeaux} ».`,
      );
    }
  }

  /* --- Placement ---------------------------------------------------- */

  /** `grid[clayette - 1][rang - 1]` : bouteille posée à cet emplacement. */
  const grid: (BottleDraft | undefined)[][] = shelves.map((shelf) =>
    Array.from<BottleDraft | undefined>({ length: shelf.capacite }),
  );
  const placed: { draft: BottleDraft; forme: Forme; slot: SlotRef }[] = [];
  const pending: { draft: BottleDraft; forme: Forme; reason: string; silent: boolean }[] = [];

  // 1re passe : les bouteilles dont l'emplacement indiqué est valable le gardent.
  for (const draft of bottleDrafts) {
    const nom = formatWine(draft);
    const shelf = draft.slot ? shelves[draft.slot.clayette - 1] : undefined;
    let forme = draft.forme;
    if (forme === null) {
      forme = shelf && shelf.type !== 'tout' ? shelf.type : 'bordeaux';
      if (columns.has('forme')) {
        const origine =
          shelf && shelf.type !== 'tout' && draft.slot
            ? `d'après le type de la clayette ${draft.slot.clayette}`
            : 'par défaut';
        warn(
          draft.line,
          draft.formeText
            ? `forme « ${draft.formeText} » non reconnue — ${nom} : « ${FORME_LABELS[forme]} » ${origine}.`
            : `forme absente — ${nom} : « ${FORME_LABELS[forme]} » ${origine}.`,
        );
      }
    }

    if (!draft.slot) {
      // Sans colonnes de position, l'avertissement global suffit.
      pending.push({ draft, forme, reason: draft.slotIssue, silent: !positionColumns });
      continue;
    }
    const row = grid[draft.slot.clayette - 1];
    if (!shelf || !row || draft.slot.rang > shelf.capacite) {
      pending.push({
        draft,
        forme,
        reason: `l'emplacement ${formatSlot(draft.slot)} n'existe pas dans la cave`,
        silent: false,
      });
      continue;
    }
    if (!isCompatible(forme, shelf.type)) {
      pending.push({
        draft,
        forme,
        reason: `forme ${FORME_LABELS[forme]} incompatible avec la clayette ${draft.slot.clayette} (emplacements ${TYPE_CLAYETTE_LABELS[shelf.type]})`,
        silent: false,
      });
      continue;
    }
    const occupant = row[draft.slot.rang - 1];
    if (occupant) {
      pending.push({
        draft,
        forme,
        reason: `l'emplacement ${formatSlot(draft.slot)} est déjà occupé par ${formatWine(occupant)} (ligne ${occupant.line})`,
        silent: false,
      });
      continue;
    }
    row[draft.slot.rang - 1] = draft;
    placed.push({ draft, forme, slot: draft.slot });
  }

  // 2e passe : les autres vont sur le premier emplacement libre compatible (ordre de lecture).
  const firstFreeSlot = (forme: Forme): SlotRef | null => {
    for (let c = 0; c < shelves.length; c++) {
      const shelf = shelves[c];
      const row = grid[c];
      if (!shelf || !row || !isCompatible(forme, shelf.type)) continue;
      for (let r = 0; r < shelf.capacite; r++) {
        if (row[r] === undefined) return { clayette: c + 1, rang: r + 1 };
      }
    }
    return null;
  };
  for (const { draft, forme, reason, silent } of pending) {
    const nom = formatWine(draft);
    const slot = firstFreeSlot(forme);
    if (!slot) {
      ignore(
        draft.line,
        `${nom} — ${reason} ; aucun emplacement libre compatible avec une bouteille de forme ${FORME_LABELS[forme]} : bouteille ignorée.`,
      );
      continue;
    }
    const row = grid[slot.clayette - 1];
    if (row) row[slot.rang - 1] = draft;
    placed.push({ draft, forme, slot });
    if (!silent) warn(draft.line, `${nom} — ${reason} ; bouteille replacée en ${formatSlot(slot)}.`);
  }

  /* --- Résultat ------------------------------------------------------ */

  // Les bouteilles replacées reprennent leur rang dans l'ordre du fichier.
  placed.sort((a, b) => a.draft.index - b.draft.index);
  // L'identifiant du fichier est conservé s'il est exploitable et unique.
  const seenIds = new Set<string>();
  const bottleId = (id: string): string => {
    if (id === '' || id.length > 80 || seenIds.has(id)) return newBottleId();
    seenIds.add(id);
    return id;
  };
  const bottles: Bottle[] = placed.map(({ draft, forme, slot }) => ({
    id: bottleId(draft.id),
    chateau: draft.chateau,
    appellation: draft.appellation,
    annee: draft.annee,
    cepages: draft.cepages,
    robe: draft.robe,
    forme,
    collection: draft.collection,
    clayette: slot.clayette,
    rang: slot.rang,
  }));

  return {
    cellar: { shelves, bottles },
    errors: [],
    warnings: warnings(),
    stats: { bouteilles: bottles.length, clayettes: shelves.length, lignesIgnorees },
  };
}
