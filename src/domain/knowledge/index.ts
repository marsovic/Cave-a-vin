import { norm } from '../normalize';
import type { Forme, Robe, WineFields } from '../types';
import { APPELLATIONS } from './appellations';

/** Fiche d'une appellation dans la base de connaissances embarquée. */
export interface AppellationInfo {
  /** Nom canonique, avec accents (« Haut-Médoc »). */
  nom: string;
  /** Autres graphies / noms usuels. */
  alias?: string[];
  /** Région viticole (« Bordeaux », « Bourgogne », « Vallée du Rhône », « Toscane »…). */
  region: string;
  pays: string;
  /** Robes produites, la plus courante en premier. */
  robes: Robe[];
  /** Forme de bouteille habituelle. */
  forme: Forme;
  /** Cépages typiques par robe (principaux d'abord). */
  cepages: Partial<Record<Robe, string[]>>;
  /**
   * Fenêtre de dégustation typique par robe, en années après le millésime :
   * [début, fin] pour un vin « moyen » de l'appellation.
   */
  garde: Partial<Record<Robe, [number, number]>>;
  /** `true` pour les vins effervescents (Champagne, Crémant, Prosecco, Cava…). */
  effervescent?: boolean;
}

/** Cépages connus en plus de ceux cités par les appellations. */
const EXTRA_CEPAGES = [
  'Alicante Bouschet',
  'Arinto',
  'Assyrtiko',
  'Auxerrois',
  'Cabernet Sauvignon',
  'Carignan',
  'Chasselas',
  'Cinsault',
  'Counoise',
  'Côt',
  'Fiano',
  'Gros Plant',
  'Grolleau',
  'Malbec',
  'Marselan',
  'Merlot',
  'Mourvèdre',
  'Muscat',
  'Nero d\'Avola',
  'Petite Arvine',
  'Petite Sirah',
  'Pinot Meunier',
  'Pineau d\'Aunis',
  'Romorantin',
  'Sauvignon gris',
  'Tannat',
  'Terret',
  'Torrontés',
  'Trebbiano',
  'Ugni blanc',
  'Vermentino',
  'Zinfandel',
];

/** Abréviations et synonymes courants → nom canonique (clés normalisées). */
const SIMPLIFY: [RegExp, string][] = [
  [/\b(?:aoc|aop|aoq|doc|docg|igp|igt|do|doca)\b/g, ' '],
  [/\b(?:appellation|d origine|origine|controlee|protegee)\b/g, ' '],
  [/\b1er\b/g, 'premier'],
  [/\b1ere\b/g, 'premiere'],
  [/\bst\b/g, 'saint'],
  [/\bste\b/g, 'sainte'],
];

/** Mentions qui ne changent pas l'appellation de base. */
const QUALIFIERS =
  /\b(?:premier cru|premiere cote|grand cru classe|grand cru|cru classe|cru bourgeois|villages?|vieilles vignes|superieur|sec|demi sec|moelleux|brut|extra brut|millesime|rouge|blanc|rose|blanc de blancs|blanc de noirs|sur lie|classico|riserva|reserva|gran reserva|crianza)\b/g;

function clean(text: string): string {
  let t = norm(text);
  for (const [re, by] of SIMPLIFY) t = t.replace(re, by);
  return t.replace(/\s+/g, ' ').trim();
}

/** Longueur minimale d'un nom pour être reconnu à l'intérieur d'une saisie plus longue. */
const MIN_CONTAINED = 6;

interface IndexEntry {
  key: string;
  info: AppellationInfo;
}

let indexCache: { exact: Map<string, AppellationInfo>; entries: IndexEntry[] } | null = null;

function index(): { exact: Map<string, AppellationInfo>; entries: IndexEntry[] } {
  if (indexCache) return indexCache;
  const exact = new Map<string, AppellationInfo>();
  const entries: IndexEntry[] = [];
  for (const info of APPELLATIONS) {
    for (const name of [info.nom, ...(info.alias ?? [])]) {
      const key = clean(name);
      if (!key) continue;
      // Le nom canonique d'une appellation prime sur l'alias d'une autre.
      if (!exact.has(key) || name === info.nom) exact.set(key, info);
      entries.push({ key, info });
    }
  }
  // Les noms les plus longs d'abord : « bordeaux superieur » avant « bordeaux ».
  entries.sort((a, b) => b.key.length - a.key.length);
  indexCache = { exact, entries };
  return indexCache;
}

/** Recherche tolérante d'une appellation (casse, accents, alias, « AOC … », mentions de cru). */
export function findAppellation(name: string): AppellationInfo | undefined {
  const query = clean(name);
  if (query.length < 3) return undefined;
  const { exact, entries } = index();

  const direct = exact.get(query);
  if (direct) return direct;

  // La saisie contient le nom d'une appellation (mots entiers) : la plus longue l'emporte
  // (« Chianti Classico Riserva » → Chianti Classico, pas Chianti). Les noms très courts
  // (« Asti », « Port », « Bourg »…) ne sont acceptés qu'en correspondance exacte.
  const padded = ` ${query} `;
  for (const entry of entries) {
    if (entry.key.length >= MIN_CONTAINED && padded.includes(` ${entry.key} `)) return entry.info;
  }

  // Sans les mentions (« premier cru », « villages », « rouge »…).
  const stripped = query.replace(QUALIFIERS, ' ').replace(/\s+/g, ' ').trim();
  if (stripped && stripped !== query) {
    const base = exact.get(stripped);
    if (base) return base;
  }

  // La saisie est le début (mots entiers) d'une seule appellation : « chateauneuf » → Châteauneuf-du-Pape.
  if (query.length >= 5) {
    const found = new Set<AppellationInfo>();
    for (const entry of entries) {
      if (entry.key.startsWith(`${query} `)) found.add(entry.info);
    }
    if (found.size === 1) return [...found][0];
  }
  return undefined;
}

let namesCache: string[] | null = null;
let cepagesCache: string[] | null = null;

/** Noms canoniques de toutes les appellations connues, triés (pour l'autocomplétion). */
export function appellationNames(): string[] {
  namesCache ??= APPELLATIONS.map((a) => a.nom).sort((a, b) => a.localeCompare(b, 'fr'));
  return namesCache;
}

/** Noms de cépages connus, triés (pour l'autocomplétion). */
export function cepageNames(): string[] {
  if (cepagesCache) return cepagesCache;
  const seen = new Map<string, string>();
  const add = (c: string): void => {
    const key = norm(c);
    if (!seen.has(key)) seen.set(key, c);
  };
  for (const a of APPELLATIONS) for (const list of Object.values(a.cepages)) list?.forEach(add);
  EXTRA_CEPAGES.forEach(add);
  cepagesCache = [...seen.values()].sort((a, b) => a.localeCompare(b, 'fr'));
  return cepagesCache;
}

/**
 * Valeurs par défaut déduites d'une appellation, pour préremplir le formulaire :
 * robe la plus courante (si `robe` n'est pas imposée), forme habituelle, cépages typiques
 * pour la robe retenue. Objet vide si l'appellation est inconnue.
 */
export function suggestWineDefaults(
  appellation: string,
  robe?: Robe | '',
): { robe?: Robe; forme?: Forme; cepages?: string[] } {
  const info = findAppellation(appellation);
  if (!info) return {};
  const chosen = robe || info.robes[0];
  const cepages = chosen ? info.cepages[chosen] : undefined;
  return {
    ...(chosen ? { robe: chosen } : {}),
    forme: info.forme,
    ...(cepages ? { cepages: [...cepages] } : {}),
  };
}

const TANNIQUES = [
  'cabernet sauvignon',
  'syrah',
  'shiraz',
  'nebbiolo',
  'tannat',
  'malbec',
  'cot',
  'mourvedre',
  'aglianico',
  'tempranillo',
  'sangiovese',
  'touriga nacional',
  'petit verdot',
  'carmenere',
];
const LEGERS = ['gamay', 'pinot noir', 'poulsard', 'trousseau', 'grolleau', 'dolcetto', 'cinsault', 'pineau d aunis'];
const BLANCS_DE_GARDE = ['riesling', 'chenin', 'chenin blanc', 'savagnin', 'furmint', 'petit manseng'];
const BLANCS_RONDS = ['chardonnay', 'marsanne', 'roussanne', 'semillon', 'pinot gris'];

/**
 * Fenêtre de garde générique (années après le millésime) quand l'appellation est
 * inconnue : selon la robe et, si possible, les cépages.
 */
export function genericGarde(wine: Pick<WineFields, 'robe' | 'cepages'>): [number, number] {
  const cepages = wine.cepages.map(norm);
  const has = (list: string[]): boolean => cepages.some((c) => list.some((ref) => c.includes(ref)));
  switch (wine.robe) {
    case 'rose':
      return [0, 2];
    case 'blanc-liquoreux':
      // Les muscats doux se boivent jeunes, sur le fruit.
      if (has(['muscat', 'moscato', 'moscatel'])) return [0, 5];
      return [5, 25];
    case 'blanc':
      if (has(BLANCS_DE_GARDE)) return [2, 10];
      if (has(BLANCS_RONDS)) return [2, 7];
      return [1, 5];
    case 'rouge':
      if (has(TANNIQUES)) return [4, 12];
      if (has(LEGERS)) return [2, 7];
      return [3, 9];
  }
}

export { APPELLATIONS };
