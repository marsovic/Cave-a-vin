import type { Forme, Robe, SlotRef, TypeClayette } from './types';

/** Libellés français affichés dans l'interface et écrits dans le CSV. */
export const ROBE_LABELS: Record<Robe, string> = {
  rouge: 'Rouge',
  blanc: 'Blanc',
  'blanc-liquoreux': 'Blanc liquoreux',
  rose: 'Rosé',
};

export const FORME_LABELS: Record<Forme, string> = {
  bordeaux: 'Bordeaux',
  bourgogne: 'Bourgogne',
  champagne: 'Champagne',
  autre: 'Autre',
};

export const TYPE_CLAYETTE_LABELS: Record<TypeClayette, string> = {
  bordeaux: 'Bordeaux',
  bourgogne: 'Bourgogne',
  champagne: 'Champagne',
  tout: 'Tout',
};

/** Abréviations pour l'étiquette des clayettes dans le schéma. */
export const TYPE_CLAYETTE_SHORT: Record<TypeClayette, string> = {
  bordeaux: 'Bdx',
  bourgogne: 'Bgn',
  champagne: 'Chp',
  tout: 'Tout',
};

/** « Clayette 3, rang 5 ». */
export function formatSlot(slot: SlotRef): string {
  return `clayette ${slot.clayette}, rang ${slot.rang}`;
}

/** « C3·R5 » (forme compacte). */
export function formatSlotShort(slot: SlotRef): string {
  return `C${slot.clayette}·R${slot.rang}`;
}

/** « Château Margaux 2015 » ou « Château Margaux (non millésimé) ». */
export function formatWine(w: { chateau: string; appellation: string; annee: number | null }): string {
  const nom = w.chateau.trim() || w.appellation.trim() || 'Bouteille sans nom';
  return w.annee == null ? nom : `${nom} ${w.annee}`;
}
