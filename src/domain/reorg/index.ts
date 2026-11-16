import { bottleAt, isCompatible, isValidSlot, sameSlot } from '../cellar';
import { formatSlot, formatWine, FORME_LABELS, TYPE_CLAYETTE_LABELS } from '../labels';
import type { Bottle, Cellar, Result, SlotRef } from '../types';
import { buildModel, countOrderExceptions, countOutOfOrder, countSplitGroups, VIDE } from './model';
import { HORS_CAVE, planMoves } from './moves';
import { planTarget } from './planner';
import type { ReorgOptions, ReorgPlace, ReorgPlan, ReorgState, ReorgStats, ReorgStep } from './types';

export type { ReorgMode, ReorgOptions, ReorgPlace, ReorgPlan, ReorgState, ReorgStats, ReorgStep } from './types';
export {
  LEXICOGRAPHIC,
  MAX_STABILISATION,
  REORG_WEIGHTS,
  WEIGHTS_COMPACT,
  WEIGHTS_ECONOMIQUE,
  type ReorgWeights,
} from './planner';

export const DEFAULT_REORG_OPTIONS: ReorgOptions = { mode: 'economique' };

const pluriel = (n: number, singulier: string, plur: string): string => (n > 1 ? plur : singulier);

/**
 * Calcule le rangement cible de toute la cave et la suite minimale de déplacements
 * pour y parvenir. Voir la spécification détaillée dans `planner.ts` / `moves.ts`.
 *
 * Le rangement cible trie les bouteilles par année (les plus anciennes en haut à
 * gauche, les non millésimées à la fin), respecte le type des clayettes et regroupe
 * les bouteilles d'un même château et d'une même année. Il est stable : replanifier
 * à partir de `plan.target` ne demande plus aucun déplacement.
 *
 * @throws si la cave ne respecte pas ses invariants (`validateCellar` non vide).
 */
export function planReorganization(cellar: Cellar, options: Partial<ReorgOptions> = {}): ReorgPlan {
  const opts: ReorgOptions = { ...DEFAULT_REORG_OPTIONS, ...options };
  const { model, arrangement, bottleIds } = buildModel(cellar);
  const { target, stable } = planTarget(model, arrangement, opts.mode);
  const rawMoves = planMoves({
    slots: model.slots,
    formes: model.classes.map((c) => c.forme),
    current: arrangement,
    target,
  });

  // Rejoue les déplacements pour savoir quelle bouteille physique fait chaque mouvement.
  const occupant = [...bottleIds];
  let outside: string | null = null;
  const place = (index: number): ReorgPlace => {
    if (index === HORS_CAVE) return 'hors-cave';
    const slot = model.slots[index]!;
    return { clayette: slot.clayette, rang: slot.rang };
  };
  const steps: ReorgStep[] = rawMoves.map((move, index) => {
    const bottleId = move.from === HORS_CAVE ? outside : occupant[move.from]!;
    if (bottleId === null) throw new Error('Réorganisation : incohérence interne (déplacement sans bouteille).');
    if (move.from === HORS_CAVE) outside = null;
    else occupant[move.from] = null;
    if (move.to === HORS_CAVE) outside = bottleId;
    else occupant[move.to] = bottleId;
    return { index, bottleId, from: place(move.from), to: place(move.to), temporaire: move.temporaire };
  });

  const finalSlot = new Map<string, SlotRef>();
  occupant.forEach((id, j) => {
    if (id !== null) finalSlot.set(id, place(j) as SlotRef);
  });
  const moved = new Set<string>();
  const targetCellar: Cellar = {
    shelves: cellar.shelves.map((s) => ({ ...s })),
    bottles: cellar.bottles.map((b) => {
      const slot = finalSlot.get(b.id)!;
      if (sameSlot(slot, b)) return { ...b };
      moved.add(b.id);
      return { ...b, clayette: slot.clayette, rang: slot.rang };
    }),
  };

  const stats: ReorgStats = {
    bouteilles: cellar.bottles.length,
    dejaEnPlace: cellar.bottles.length - moved.size,
    aDeplacer: moved.size,
    deplacements: steps.length,
    exceptionsOrdre: countOrderExceptions(model, target),
    groupesSepares: countSplitGroups(model, target),
  };

  const notes: string[] = [];
  if (stats.bouteilles === 0) notes.push('La cave est vide : il n\'y a rien à ranger.');
  else if (steps.length === 0) notes.push('La cave est déjà rangée.');
  if (stats.exceptionsOrdre > 0) {
    const n = countOutOfOrder(model, target);
    notes.push(
      `${n} ${pluriel(n, 'bouteille reste', 'bouteilles restent')} hors de l'ordre strict des années à cause du type des clayettes.`,
    );
  }
  if (stats.groupesSepares > 0) {
    const n = stats.groupesSepares;
    notes.push(
      `${n} ${pluriel(n, 'groupe (même château, même année) n\'est', 'groupes (même château, même année) ne sont')} pas d'un seul tenant sur une même clayette.`,
    );
  }
  if (rawMoves.some((m) => m.to === HORS_CAVE)) {
    const pleine = !arrangement.includes(VIDE);
    notes.push(
      `${pleine ? 'Cave pleine' : 'Aucun emplacement libre compatible'} : une bouteille sera posée hors de la cave le temps de certains échanges.`,
    );
  }
  if (!stable) {
    notes.push(
      'Le rangement proposé peut encore être affiné : relancez la réorganisation une fois ces déplacements effectués.',
    );
  }

  return { options: opts, steps, target: targetCellar, stats, notes };
}

/* ------------------------------------------------------------------ */
/* Exécution pas à pas                                                 */
/* ------------------------------------------------------------------ */

function formatPlace(place: ReorgPlace): string {
  return place === 'hors-cave' ? 'hors de la cave' : formatSlot(place);
}

/** Déplace la bouteille `bottleId` de `from` vers `to` après vérification de l'état. */
function transfer(state: ReorgState, bottleId: string, from: ReorgPlace, to: ReorgPlace): Result<ReorgState> {
  const { cellar, horsCave } = state;
  let bottle: Bottle | undefined;
  if (from === 'hors-cave') {
    bottle = horsCave.find((b) => b.id === bottleId);
    if (!bottle) return { ok: false, error: 'La bouteille à déplacer n\'est pas posée hors de la cave.' };
  } else {
    bottle = cellar.bottles.find((b) => b.id === bottleId);
    if (!bottle) {
      const dehors = horsCave.some((b) => b.id === bottleId);
      return {
        ok: false,
        error: dehors
          ? 'La bouteille à déplacer est posée hors de la cave.'
          : 'La bouteille à déplacer n\'est plus dans la cave.',
      };
    }
    if (!sameSlot(bottle, from)) {
      return {
        ok: false,
        error: `${formatWine(bottle)} n'est pas à l'emplacement prévu (${formatSlot(from)}) mais ${formatSlot(bottle)}.`,
      };
    }
  }

  if (to === 'hors-cave') {
    if (from === 'hors-cave') return { ok: false, error: 'La bouteille est déjà hors de la cave.' };
    return {
      ok: true,
      value: {
        cellar: { shelves: cellar.shelves, bottles: cellar.bottles.filter((b) => b.id !== bottleId) },
        horsCave: [...horsCave, bottle],
      },
    };
  }

  if (!isValidSlot(cellar, to)) {
    return { ok: false, error: `L'emplacement ${formatSlot(to)} n'existe pas dans la cave.` };
  }
  const shelf = cellar.shelves[to.clayette - 1]!;
  if (!isCompatible(bottle.forme, shelf.type)) {
    return {
      ok: false,
      error: `Une bouteille de forme ${FORME_LABELS[bottle.forme]} ne peut pas aller sur la clayette ${to.clayette} (emplacements ${TYPE_CLAYETTE_LABELS[shelf.type]}).`,
    };
  }
  const occupant = bottleAt(cellar, to);
  if (occupant) {
    return {
      ok: false,
      error:
        occupant.id === bottleId
          ? `${formatWine(bottle)} est déjà à l'emplacement ${formatSlot(to)}.`
          : `L'emplacement ${formatSlot(to)} est occupé par ${formatWine(occupant)}.`,
    };
  }
  const placed: Bottle = { ...bottle, clayette: to.clayette, rang: to.rang };
  if (from === 'hors-cave') {
    return {
      ok: true,
      value: {
        cellar: { shelves: cellar.shelves, bottles: [...cellar.bottles, placed] },
        horsCave: horsCave.filter((b) => b.id !== bottleId),
      },
    };
  }
  return {
    ok: true,
    value: {
      cellar: { shelves: cellar.shelves, bottles: cellar.bottles.map((b) => (b.id === bottleId ? placed : b)) },
      horsCave,
    },
  };
}

/**
 * Applique un déplacement du plan à l'état courant (échoue si l'état ne correspond pas à l'étape) :
 * la bouteille doit se trouver en `step.from`, et `step.to` doit être libre et compatible.
 *
 * Une bouteille posée hors de la cave quitte `cellar.bottles` pour `horsCave` (elle y
 * garde son dernier emplacement) ; à son retour elle est ajoutée en fin de tableau :
 * l'ordre de `cellar.bottles` n'est pas significatif (voir `sameReorgState`).
 */
export function applyReorgStep(state: ReorgState, step: ReorgStep): Result<ReorgState> {
  const result = transfer(state, step.bottleId, step.from, step.to);
  if (result.ok) return result;
  return { ok: false, error: `Étape ${step.index + 1} impossible : ${result.error}` };
}

/** Annule un déplacement précédemment appliqué (opération inverse de `applyReorgStep`). */
export function revertReorgStep(state: ReorgState, step: ReorgStep): Result<ReorgState> {
  const result = transfer(state, step.bottleId, step.to, step.from);
  if (result.ok) return result;
  return {
    ok: false,
    error: `Annulation de l'étape ${step.index + 1} impossible (retour vers ${formatPlace(step.from)}) : ${result.error}`,
  };
}

/* ------------------------------------------------------------------ */
/* Comparaisons                                                        */
/* ------------------------------------------------------------------ */

const byId = (a: Bottle, b: Bottle): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

function sameBottles(a: readonly Bottle[], b: readonly Bottle[], withSlot: boolean): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort(byId);
  const sb = [...b].sort(byId);
  return sa.every((x, i) => {
    const y = sb[i]!;
    return (
      x.id === y.id &&
      (!withSlot || sameSlot(x, y)) &&
      x.chateau === y.chateau &&
      x.appellation === y.appellation &&
      x.annee === y.annee &&
      x.robe === y.robe &&
      x.forme === y.forme &&
      x.collection === y.collection &&
      x.cepages.length === y.cepages.length &&
      x.cepages.every((c, k) => c === y.cepages[k])
    );
  });
}

/** Deux caves ont-elles les mêmes clayettes et les mêmes bouteilles aux mêmes emplacements (ordre des tableaux ignoré) ? */
export function sameCellarContent(a: Cellar, b: Cellar): boolean {
  return (
    a.shelves.length === b.shelves.length &&
    a.shelves.every((s, i) => s.capacite === b.shelves[i]!.capacite && s.type === b.shelves[i]!.type) &&
    sameBottles(a.bottles, b.bottles, true)
  );
}

/** Deux états d'exécution sont-ils identiques (même cave, mêmes bouteilles hors cave) ? */
export function sameReorgState(a: ReorgState, b: ReorgState): boolean {
  return sameCellarContent(a.cellar, b.cellar) && sameBottles(a.horsCave, b.horsCave, false);
}
