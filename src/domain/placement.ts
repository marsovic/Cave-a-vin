import type { Cellar, SlotRef, WineFields } from './types';

/** Proposition d'emplacements pour ranger de nouvelles bouteilles. */
export interface PlacementSuggestion {
  /** Emplacements proposés (libres, compatibles), au plus `count`. */
  slots: SlotRef[];
  /** `true` si `count` emplacements ont été trouvés. */
  complete: boolean;
  /** Explication courte en français (pourquoi ces emplacements, ou pourquoi il en manque). */
  message: string;
}

/**
 * Propose les meilleurs emplacements libres pour `count` bouteilles identiques.
 *
 * Contraintes dures : emplacement libre et type de clayette compatible avec `wine.forme`.
 * `prefer.clayette` / `prefer.rang`, s'ils sont fournis, sont des contraintes dures elles aussi
 * (l'utilisateur a désigné une clayette et/ou un rang) : pour `count > 1` avec un rang imposé,
 * on part de ce rang et on continue vers la droite sur la même clayette.
 *
 * Préférences (par ordre d'importance) :
 *  1. à côté de bouteilles du même groupe (même château + même année) sur la même clayette ;
 *  2. emplacements contigus sur une même clayette pour les `count` bouteilles ;
 *  3. respect de l'ordre par année de la cave (plus anciennes en haut, plus récentes en bas,
 *     de gauche à droite) : l'emplacement idéal se situe entre les bouteilles plus anciennes
 *     et les bouteilles plus récentes ;
 *  4. clayette spécialisée (type = forme) plutôt que clayette « tout », pour garder les
 *     emplacements « tout » aux bouteilles qui n'ont pas d'autre choix ;
 *  5. à égalité : le plus haut, puis le plus à gauche.
 */
export function suggestSlots(
  cellar: Cellar,
  wine: Pick<WineFields, 'chateau' | 'annee' | 'forme'>,
  count: number,
  prefer: { clayette?: number; rang?: number } = {},
): PlacementSuggestion {
  void cellar; void wine; void count; void prefer;
  throw new Error('non implémenté');
}
