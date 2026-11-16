import type { Bottle, Cellar, DrinkStatus, DrinkWindow, WineFields } from './types';

/**
 * Estimation LOCALE (sans internet) de la fenêtre de dégustation d'un vin, à partir de
 * la base de connaissances (appellation, robe, cépages). `null` si le vin n'a pas de millésime.
 */
export function estimateDrinkWindow(wine: WineFields): DrinkWindow | null {
  void wine;
  throw new Error('non implémenté');
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
  void window; void year;
  throw new Error('non implémenté');
}

/** Accord entre un plat et un vin. */
export interface Pairing {
  /** 0 (à éviter) … 100 (accord idéal). */
  score: number;
  /** Justification courte en français. */
  raison: string;
  source: 'local' | 'ia' | 'ia-web';
}

/**
 * Accord LOCAL (sans internet) entre un plat décrit librement en français et un vin,
 * par règles (familles de plats ↔ robe, région, cépages, âge).
 */
export function localPairing(plat: string, wine: WineFields): Pairing {
  void plat; void wine;
  throw new Error('non implémenté');
}

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

/**
 * « À boire rapidement » : vins HORS collection dont le statut est `a-boire-vite`,
 * triés par urgence (fin de fenêtre la plus proche d'abord).
 */
export function reportDrinkSoon(cellar: Cellar, year: number, sources?: AdviceSources): AdviceItem[] {
  void cellar; void year; void sources;
  throw new Error('non implémenté');
}

/**
 * « Accord mets-vin » : vins HORS collection convenant au plat (score >= 60),
 * triés par score décroissant. Les vins `trop-jeune` ou `passe` sont pénalisés mais restent listés.
 */
export function reportPairing(cellar: Cellar, plat: string, year: number, sources?: AdviceSources): AdviceItem[] {
  void cellar; void plat; void year; void sources;
  throw new Error('non implémenté');
}

/**
 * « À privilégier » : vins HORS collection qui conviennent au plat (score >= 60) ET
 * sont `a-boire-vite` ; triés par priorité combinée (accord × urgence).
 */
export function reportPrioritize(cellar: Cellar, plat: string, year: number, sources?: AdviceSources): AdviceItem[] {
  void cellar; void plat; void year; void sources;
  throw new Error('non implémenté');
}

/**
 * « Candidates collection » : vins HORS collection dont le statut est `passe`
 * (probablement trop marqués par le temps pour être bus), les plus dépassés d'abord.
 */
export function reportCollectionCandidates(cellar: Cellar, year: number, sources?: AdviceSources): AdviceItem[] {
  void cellar; void year; void sources;
  throw new Error('non implémenté');
}

/** Vins distincts (une entrée par `wineKey`) hors collection — ce qu'on soumet à l'IA. */
export function distinctWines(cellar: Cellar, opts?: { includeCollection?: boolean }): WineFields[] {
  void cellar; void opts;
  throw new Error('non implémenté');
}
