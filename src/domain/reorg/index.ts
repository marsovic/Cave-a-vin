import type { Cellar, Result } from '../types';
import type { ReorgOptions, ReorgPlan, ReorgState, ReorgStep } from './types';

export type { ReorgMode, ReorgOptions, ReorgPlace, ReorgPlan, ReorgState, ReorgStats, ReorgStep } from './types';

export const DEFAULT_REORG_OPTIONS: ReorgOptions = { mode: 'economique' };

/**
 * Calcule le rangement cible de toute la cave et la suite minimale de déplacements
 * pour y parvenir. Voir la spécification détaillée dans `planner.ts` / `moves.ts`.
 */
export function planReorganization(cellar: Cellar, options: Partial<ReorgOptions> = {}): ReorgPlan {
  void cellar; void options;
  throw new Error('non implémenté');
}

/** Applique un déplacement du plan à l'état courant (échoue si l'état ne correspond pas à l'étape). */
export function applyReorgStep(state: ReorgState, step: ReorgStep): Result<ReorgState> {
  void state; void step;
  throw new Error('non implémenté');
}

/** Annule un déplacement précédemment appliqué (opération inverse de `applyReorgStep`). */
export function revertReorgStep(state: ReorgState, step: ReorgStep): Result<ReorgState> {
  void state; void step;
  throw new Error('non implémenté');
}
