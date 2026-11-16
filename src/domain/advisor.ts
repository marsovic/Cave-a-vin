import { bottlesInReadingOrder } from './cellar';
import { findAppellation, genericGarde, type AppellationInfo } from './knowledge';
import { DISH_RULES, PROFILES, PROFILE_LABELS, type DishRule, type Profile } from './knowledge/pairing-rules';
import { ROBE_LABELS } from './labels';
import { norm, wineKey } from './normalize';
import type { Bottle, Cellar, DrinkStatus, DrinkWindow, WineFields } from './types';

/* ------------------------------------------------------------------ */
/* Fenêtre de dégustation                                              */
/* ------------------------------------------------------------------ */

/**
 * Estimation LOCALE (sans internet) de la fenêtre de dégustation d'un vin, à partir de
 * la base de connaissances (appellation, robe, cépages). `null` si le vin n'a pas de millésime.
 */
export function estimateDrinkWindow(wine: WineFields): DrinkWindow | null {
  if (wine.annee === null) return null;
  const info = wine.appellation.trim() ? findAppellation(wine.appellation) : undefined;
  const known = info?.garde[wine.robe];
  const [debut, fin] = known ?? genericGarde(wine);
  const robe = ROBE_LABELS[wine.robe].toLowerCase();
  const note =
    info && known
      ? `Fenêtre typique d'un ${info.nom} ${robe} : ${debut} à ${fin} ans.`
      : `Estimation générale pour un ${robe === 'rouge' || robe === 'rosé' ? robe : `vin ${robe}`} : ${debut} à ${fin} ans.`;
  return { debut: wine.annee + debut, fin: wine.annee + fin, source: 'local', note };
}

/**
 * Statut de dégustation pour l'année `year` :
 *  - `inconnu` si `window` est `null` ;
 *  - `trop-jeune` si year < debut ;
 *  - `passe` si year > fin ;
 *  - `a-boire-vite` si la fin est proche : fin - year <= max(1, arrondi(20 % de la durée de la fenêtre)) ;
 *  - `a-boire` sinon.
 */
export function drinkStatus(window: DrinkWindow | null, year: number): DrinkStatus {
  if (!window) return 'inconnu';
  if (year < window.debut) return 'trop-jeune';
  if (year > window.fin) return 'passe';
  const threshold = Math.max(1, Math.round((window.fin - window.debut) * 0.2));
  return window.fin - year <= threshold ? 'a-boire-vite' : 'a-boire';
}

const SOURCE_SUFFIX: Record<DrinkWindow['source'], string> = {
  local: 'estimation locale',
  ia: 'selon l\'assistant IA',
  'ia-web': 'selon l\'assistant IA et sa recherche web',
};

/** Phrase française résumant la fenêtre de dégustation et le statut (infobulles, fiches). */
export function describeWindow(window: DrinkWindow | null, year: number): string {
  if (!window) return 'Non millésimé : à boire sans trop attendre.';
  const range = window.debut === window.fin ? `${window.debut}` : `${window.debut}–${window.fin}`;
  const source = SOURCE_SUFFIX[window.source];
  switch (drinkStatus(window, year)) {
    case 'trop-jeune': {
      const wait = window.debut - year;
      return `À attendre encore ${wait} an${wait > 1 ? 's' : ''} : fenêtre ${range} (${source}).`;
    }
    case 'a-boire':
      return `À boire, sans urgence : fenêtre ${range} (${source}).`;
    case 'a-boire-vite':
      return window.fin === year
        ? `À boire cette année : fenêtre ${range} (${source}).`
        : `À boire avant fin ${window.fin} : fenêtre ${range} (${source}).`;
    case 'passe': {
      const late = year - window.fin;
      return `Fenêtre dépassée depuis ${late} an${late > 1 ? 's' : ''} : ${range} (${source}).`;
    }
    case 'inconnu':
      return 'Fenêtre de dégustation inconnue.';
  }
}

/* ------------------------------------------------------------------ */
/* Accords mets-vin                                                    */
/* ------------------------------------------------------------------ */

/** Accord entre un plat et un vin. */
export interface Pairing {
  /** 0 (à éviter) … 100 (accord idéal). */
  score: number;
  /** Justification courte en français. */
  raison: string;
  source: 'local' | 'ia' | 'ia-web';
}

const ROUGES_PUISSANTS = ['cabernet sauvignon', 'syrah', 'shiraz', 'nebbiolo', 'tannat', 'malbec', 'cot', 'mourvedre', 'aglianico', 'touriga', 'petit verdot', 'carmenere', 'tinta roriz'];
const ROUGES_LEGERS = ['gamay', 'pinot noir', 'poulsard', 'trousseau', 'grolleau', 'dolcetto', 'cinsault', 'pineau d aunis', 'mondeuse', 'lambrusco'];
const BLANCS_VIFS = ['sauvignon', 'melon', 'aligote', 'piquepoul', 'jacquere', 'albarino', 'alvarinho', 'verdejo', 'riesling', 'colombard', 'vermentino', 'rolle', 'garganega', 'cortese', 'sylvaner', 'chasselas', 'gros plant', 'gruner veltliner', 'ugni blanc', 'loureiro', 'pinot blanc', 'palomino', 'altesse', 'glera', 'folle blanche'];
const BLANCS_AROMATIQUES = ['gewurztraminer', 'muscat', 'viognier', 'pinot gris', 'torrontes', 'moscato'];
const VINS_DOUX_ROUGES = ['banyuls', 'maury', 'porto'];

/** Profil gustatif simplifié d'un vin, déduit de la robe, de l'appellation et des cépages. */
export function wineProfile(wine: WineFields, info: AppellationInfo | undefined = findAppellation(wine.appellation)): Profile {
  const text = norm(`${wine.appellation} ${wine.chateau}`);
  const cepages = (wine.cepages.length > 0 ? wine.cepages : (info?.cepages[wine.robe] ?? [])).map(norm);
  const main = cepages[0] ?? '';
  const anyOf = (list: string[], pool: string[] = cepages): boolean => pool.some((c) => list.some((ref) => c.includes(ref)));

  if (wine.robe === 'blanc-liquoreux') return 'liquoreux';
  const sparkling = info?.effervescent === true || /\b(cremant|champagne|mousseux|petillant|prosecco|cava)\b/.test(text);
  if (sparkling) return 'bulles';
  if (wine.robe === 'rose') return 'rose';

  if (wine.robe === 'rouge') {
    if (VINS_DOUX_ROUGES.some((v) => text.includes(v))) return 'rougeDoux';
    const fin = info?.garde.rouge?.[1];
    if (anyOf(ROUGES_LEGERS, [main])) return 'rougeLeger';
    if (anyOf(ROUGES_PUISSANTS, [main]) || (fin !== undefined && fin >= 18)) return 'rougePuissant';
    if (main === '' && fin !== undefined && fin <= 5) return 'rougeLeger';
    if (anyOf(ROUGES_PUISSANTS) && fin !== undefined && fin >= 12) return 'rougePuissant';
    return 'rougeMoyen';
  }

  // Blanc sec.
  if (text.includes('chablis')) return 'blancVif';
  if (anyOf(BLANCS_AROMATIQUES, [main])) return 'blancAromatique';
  if (anyOf(BLANCS_VIFS, [main])) return 'blancVif';
  if (main === '') return 'blancVif';
  return 'blancRond';
}

function matchesRule(rule: DishRule, padded: string): boolean {
  return rule.mots.some((mot) => (mot.endsWith('$') ? padded.includes(` ${mot.slice(0, -1)} `) : padded.includes(` ${mot}`)));
}

/** Familles de plats reconnues dans une description libre. */
export function recognizeDish(plat: string): DishRule[] {
  // « pomme de terre » n'est pas un dessert aux pommes.
  const padded = ` ${norm(plat)} `.replace(/ pommes? de terre /g, ' patate ');
  if (padded.trim() === '') return [];
  const found = DISH_RULES.filter((rule) => matchesRule(rule, padded));
  // « plateau de fromages » générique : ignoré si un fromage précis est reconnu ; idem pour les desserts.
  const specificCheese = found.some((r) => ['fromage-dur', 'bleu', 'chevre', 'pate-molle', 'croute-lavee', 'fromage-frais'].includes(r.id));
  const specificDessert = found.some((r) => r.id === 'chocolat' || r.id === 'noix-caramel');
  return found.filter((r) => !(r.id === 'fromages' && specificCheese) && !(r.id === 'dessert-fruits' && specificDessert));
}

function verdict(score: number): string {
  if (score >= 85) return 'accompagne idéalement';
  if (score >= 70) return 'va bien avec';
  if (score >= 60) return 'peut convenir à';
  if (score >= 40) return 'n\'est pas l\'accord le plus évident pour';
  return 'est déconseillé avec';
}

/**
 * Accord LOCAL (sans internet) entre un plat décrit librement en français et un vin,
 * par règles (familles de plats ↔ robe, région, cépages).
 */
export function localPairing(plat: string, wine: WineFields): Pairing {
  const rules = recognizeDish(plat);
  if (rules.length === 0) {
    return {
      score: 50,
      raison: 'Plat non reconnu par les règles locales : essayez l\'assistant IA.',
      source: 'local',
    };
  }
  const info = wine.appellation.trim() ? findAppellation(wine.appellation) : undefined;
  const profile = wineProfile(wine, info);
  const column = PROFILES.indexOf(profile);
  const tags = ` ${norm(
    [wine.appellation, info?.nom, info?.region, info?.pays, ...(wine.cepages.length > 0 ? wine.cepages : (info?.cepages[wine.robe] ?? []))]
      .filter(Boolean)
      .join(' '),
  )} `;

  let total = 0;
  let best: { rule: DishRule; score: number } | null = null;
  for (const rule of rules) {
    const base = rule.scores[column] ?? 50;
    let bonus = 0;
    for (const [pattern, points] of rule.bonus ?? []) {
      if (tags.includes(` ${pattern} `) || tags.includes(` ${pattern}`)) bonus = Math.max(bonus, points);
    }
    // Un accord régional ne rattrape pas un profil inadapté.
    const score = Math.max(0, Math.min(100, base + (base >= 45 ? bonus : bonus / 2)));
    total += score;
    if (!best || score < best.score) best = { rule, score };
  }
  const score = Math.round(total / rules.length);
  // La justification cite la famille la plus contraignante (celle qui tire la note vers le bas).
  const rule = best!.rule;
  const name = info ? `${PROFILE_LABELS[profile]} (${info.nom})` : PROFILE_LABELS[profile];
  return {
    score,
    raison: `Un ${name} ${verdict(score)} ${rule.label}.`,
    source: 'local',
  };
}

/* ------------------------------------------------------------------ */
/* Rapports                                                            */
/* ------------------------------------------------------------------ */

/** Une ligne de rapport : un vin (toutes ses bouteilles concernées) et le conseil associé. */
export interface AdviceItem {
  /** Clé du vin (`wineKey`). */
  key: string;
  /** Bouteilles concernées, dans l'ordre de lecture de la cave. */
  bottles: Bottle[];
  window: DrinkWindow | null;
  status: DrinkStatus;
  /** Présent pour les rapports liés à un plat. */
  pairing?: Pairing;
  /** Priorité d'affichage : plus grand = plus prioritaire. */
  priorite: number;
  /** Phrase affichée sous le nom du vin (français). */
  raison: string;
}

/** Fenêtres de dégustation et accords connus, indexés par `wineKey`. Les entrées absentes sont estimées localement. */
export interface AdviceSources {
  windows?: ReadonlyMap<string, DrinkWindow>;
  pairings?: ReadonlyMap<string, Pairing>;
}

/** Seuil à partir duquel un vin « convient » à un plat. */
export const PAIRING_THRESHOLD = 60;

interface WineGroup {
  key: string;
  bottles: Bottle[];
  window: DrinkWindow | null;
  status: DrinkStatus;
}

function groups(cellar: Cellar, year: number, sources: AdviceSources | undefined): WineGroup[] {
  const map = new Map<string, Bottle[]>();
  for (const b of bottlesInReadingOrder(cellar)) {
    if (b.collection) continue;
    const key = wineKey(b);
    const list = map.get(key);
    if (list) list.push(b);
    else map.set(key, [b]);
  }
  return [...map.entries()].map(([key, bottles]) => {
    const sample = bottles[0]!;
    // Une fenêtre fournie par l'IA n'a de sens que pour un vin millésimé.
    const window = sample.annee === null ? null : (sources?.windows?.get(key) ?? estimateDrinkWindow(sample));
    return { key, bottles, window, status: drinkStatus(window, year) };
  });
}

function byPriority(a: AdviceItem, b: AdviceItem): number {
  return (
    b.priorite - a.priorite ||
    (a.bottles[0]?.annee ?? 9999) - (b.bottles[0]?.annee ?? 9999) ||
    a.key.localeCompare(b.key)
  );
}

function windowReason(window: DrinkWindow | null, year: number): string {
  const text = describeWindow(window, year);
  return window?.note && window.source !== 'local' ? `${text} ${window.note}` : text;
}

/**
 * « À boire rapidement » : vins HORS collection dont le statut est `a-boire-vite`,
 * triés par urgence (fin de fenêtre la plus proche d'abord).
 */
export function reportDrinkSoon(cellar: Cellar, year: number, sources?: AdviceSources): AdviceItem[] {
  return groups(cellar, year, sources)
    .filter((g) => g.status === 'a-boire-vite' && g.window)
    .map((g) => ({
      key: g.key,
      bottles: g.bottles,
      window: g.window,
      status: g.status,
      priorite: 1000 - (g.window!.fin - year) * 10 + Math.min(9, g.bottles.length) / 10,
      raison: windowReason(g.window, year),
    }))
    .sort(byPriority);
}

function pairingFor(g: WineGroup, plat: string, sources: AdviceSources | undefined): Pairing {
  const known = sources?.pairings?.get(g.key);
  if (known) return { ...known, score: Math.max(0, Math.min(100, known.score)) };
  return localPairing(plat, g.bottles[0]!);
}

/**
 * « Accord mets-vin » : vins HORS collection convenant au plat (score >= 60),
 * triés par score décroissant. Les vins `trop-jeune` ou `passe` sont pénalisés mais restent listés.
 */
export function reportPairing(cellar: Cellar, plat: string, year: number, sources?: AdviceSources): AdviceItem[] {
  const out: AdviceItem[] = [];
  for (const g of groups(cellar, year, sources)) {
    const pairing = pairingFor(g, plat, sources);
    if (pairing.score < PAIRING_THRESHOLD) continue;
    let priorite = pairing.score;
    let extra = '';
    if (g.status === 'trop-jeune') {
      priorite -= 15;
      extra = ' Encore jeune : il gagnera à attendre.';
    } else if (g.status === 'passe') {
      priorite -= 25;
      extra = ' Attention : son apogée est probablement dépassée.';
    } else if (g.status === 'a-boire-vite') {
      priorite += 3;
      extra = ' À boire sans tarder.';
    }
    out.push({
      key: g.key,
      bottles: g.bottles,
      window: g.window,
      status: g.status,
      pairing,
      priorite,
      raison: `${pairing.raison}${extra}`,
    });
  }
  return out.sort(byPriority);
}

/**
 * « À privilégier » : vins HORS collection qui conviennent au plat (score >= 60) ET
 * sont `a-boire-vite` ; triés par priorité combinée (accord × urgence).
 */
export function reportPrioritize(cellar: Cellar, plat: string, year: number, sources?: AdviceSources): AdviceItem[] {
  const out: AdviceItem[] = [];
  for (const g of groups(cellar, year, sources)) {
    if (g.status !== 'a-boire-vite' || !g.window) continue;
    const pairing = pairingFor(g, plat, sources);
    if (pairing.score < PAIRING_THRESHOLD) continue;
    const urgency = Math.max(0, 20 - (g.window.fin - year) * 5);
    out.push({
      key: g.key,
      bottles: g.bottles,
      window: g.window,
      status: g.status,
      pairing,
      priorite: pairing.score + urgency,
      raison: `${pairing.raison} ${describeWindow(g.window, year)}`,
    });
  }
  return out.sort(byPriority);
}

/**
 * « Candidates collection » : vins HORS collection dont le statut est `passe`
 * (probablement trop marqués par le temps pour être bus), les plus dépassés d'abord.
 */
export function reportCollectionCandidates(cellar: Cellar, year: number, sources?: AdviceSources): AdviceItem[] {
  return groups(cellar, year, sources)
    .filter((g) => g.status === 'passe' && g.window)
    .map((g) => ({
      key: g.key,
      bottles: g.bottles,
      window: g.window,
      status: g.status,
      priorite: year - g.window!.fin,
      raison: windowReason(g.window, year),
    }))
    .sort(byPriority);
}

/** Vins distincts (une entrée par `wineKey`) hors collection — ce qu'on soumet à l'IA. */
export function distinctWines(cellar: Cellar, opts: { includeCollection?: boolean } = {}): WineFields[] {
  const seen = new Set<string>();
  const out: WineFields[] = [];
  for (const b of bottlesInReadingOrder(cellar)) {
    if (b.collection && !opts.includeCollection) continue;
    const key = wineKey(b);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      chateau: b.chateau,
      appellation: b.appellation,
      annee: b.annee,
      cepages: [...b.cepages],
      robe: b.robe,
      forme: b.forme,
    });
  }
  return out;
}
