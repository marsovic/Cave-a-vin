import type { Forme, Robe, WineFields } from '../types';

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

/** Recherche tolérante d'une appellation (casse, accents, alias, « AOC … », pluriels simples). */
export function findAppellation(name: string): AppellationInfo | undefined {
  void name;
  throw new Error('non implémenté');
}

/** Noms canoniques de toutes les appellations connues, triés (pour l'autocomplétion). */
export function appellationNames(): string[] {
  throw new Error('non implémenté');
}

/** Noms de cépages connus, triés (pour l'autocomplétion). */
export function cepageNames(): string[] {
  throw new Error('non implémenté');
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
  void appellation; void robe;
  throw new Error('non implémenté');
}

/**
 * Fenêtre de garde générique (années après le millésime) quand l'appellation est
 * inconnue : selon la robe et, si possible, les cépages.
 */
export function genericGarde(wine: Pick<WineFields, 'robe' | 'cepages'>): [number, number] {
  void wine;
  throw new Error('non implémenté');
}
