/**
 * Calcul du RANGEMENT CIBLE de la réorganisation.
 *
 * A. Séquence canonique σ — l'ordre dans lequel les bouteilles se liront dans la cible :
 *    bouteilles triées par année (sans millésime à la fin), groupes d'un seul tenant,
 *    puis glouton sur les emplacements avec un test de faisabilité exact (comptage de
 *    Hall) pour respecter le type des clayettes.
 * B. Placement de σ sur les emplacements par programmation dynamique (alignement
 *    préservant l'ordre) : on garde un maximum de bouteilles en place tout en
 *    pénalisant les vides (mode compact) et les groupes coupés.
 * C. Deux variantes d'ordre des groupes d'une même année ('position', 'alpha') ; on
 *    garde la moins coûteuse, puis on STABILISE : la cible retenue est un point fixe
 *    du planificateur (la replanifier ne demande plus aucun déplacement).
 *
 * Tout est exprimé en classes de bouteilles interchangeables (voir `model.ts`).
 */
import { FORMES, type Forme, type TypeClayette } from '../types';
import {
  VIDE,
  classFits,
  compareText,
  countOrderExceptions,
  countSplitGroups,
  type Arrangement,
  type ReorgModel,
} from './model';
import { countMoves } from './moves';
import type { ReorgMode } from './types';

/* ------------------------------------------------------------------ */
/* Constantes                                                          */
/* ------------------------------------------------------------------ */

/** Poids de la fonction objectif du placement (voir `alignSequence`). */
export interface ReorgWeights {
  /** Gain par bouteille laissée en place (emplacement contenant déjà une bouteille identique). */
  W_FIX: number;
  /** Coût par emplacement vide situé avant la dernière bouteille. */
  W_EMPTY: number;
  /** Coût quand deux bouteilles consécutives d'un même groupe sont sur deux clayettes. */
  W_SPLIT: number;
  /** Coût quand elles sont sur la même clayette sans être voisines. */
  W_GAP: number;
}

/** Mode économique : un déplacement évité vaut 1 ; les vides sont gratuits. */
export const WEIGHTS_ECONOMIQUE: ReorgWeights = { W_FIX: 1, W_EMPTY: 0, W_SPLIT: 2.5, W_GAP: 4 };

/**
 * Mode compact : les vides coûtent. `W_FIX` (0,2) est une valeur nominale : en mode
 * compact elle est PLAFONNÉE (voir `LEXICOGRAPHIC`) pour ne servir qu'à départager.
 */
export const WEIGHTS_COMPACT: ReorgWeights = { W_FIX: 0.2, W_EMPTY: 1, W_SPLIT: 2.5, W_GAP: 4 };

export const REORG_WEIGHTS: Record<ReorgMode, ReorgWeights> = {
  economique: WEIGHTS_ECONOMIQUE,
  compact: WEIGHTS_COMPACT,
};

/**
 * Modes où l'objectif est comparé par priorités strictes (ordre lexicographique) :
 *  1. vides (W_EMPTY) et pénalités de groupe (W_SPLIT, W_GAP) ;
 *  2. « trous » : emplacements vides suivis d'une bouteille sur la même clayette ;
 *  3. bouteilles laissées en place.
 * Sans cela, en mode compact, six bouteilles en place (6 × 0,2) « paieraient » un
 * emplacement vide au milieu de la cave et le rangement ne serait plus tassé ; de
 * même un vide nécessaire (pour ne pas couper un groupe) pourrait se retrouver au
 * milieu d'une clayette plutôt qu'à son extrémité droite.
 */
export const LEXICOGRAPHIC: Record<ReorgMode, boolean> = { economique: false, compact: true };

/** Nombre maximal de replanifications lors de la stabilisation. */
export const MAX_STABILISATION = 6;

/** Nombre de replanifications où les deux variantes restent en concurrence (voir `planTarget`). */
export const FREE_STABILISATION = 2;

/** Variantes d'ordre des groupes d'une même année. */
export const VARIANTS = ['position', 'alpha'] as const;
export type Variant = (typeof VARIANTS)[number];

/** Poids entiers de l'objectif : aucune erreur d'arrondi dans les comparaisons. */
export interface IntWeights {
  /** Gain par bouteille laissée en place. */
  fix: number;
  /** Coût par emplacement vide avant la dernière bouteille. */
  empty: number;
  /** Coût supplémentaire par emplacement vide suivi d'une bouteille sur la même clayette. */
  hole: number;
  split: number;
  gap: number;
}

/**
 * Convertit les poids d'un mode en entiers, pour `n` bouteilles et `m` emplacements.
 *  - mode pondéré : poids × 10, pas de coût de « trou » ;
 *  - mode lexicographique : fix = 1 (n bouteilles en place pèsent moins qu'un trou),
 *    hole = n + 1 (m trous pèsent moins que la plus petite différence, 0,5, des autres
 *    termes), et les autres poids × 2 × (m + 1) × (n + 1).
 */
export function integerWeights(mode: ReorgMode, n: number, m: number): IntWeights {
  const w = REORG_WEIGHTS[mode];
  if (!LEXICOGRAPHIC[mode]) {
    const int = (x: number): number => Math.round(x * 10);
    return { fix: int(w.W_FIX), empty: int(w.W_EMPTY), hole: 0, split: int(w.W_SPLIT), gap: int(w.W_GAP) };
  }
  const half = (m + 1) * (n + 1);
  const int = (x: number): number => Math.round(x * 2) * half;
  return { fix: 1, empty: int(w.W_EMPTY), hole: n + 1, split: int(w.W_SPLIT), gap: int(w.W_GAP) };
}

/* ------------------------------------------------------------------ */
/* A. Séquence canonique                                               */
/* ------------------------------------------------------------------ */

const FORME_INDEX: Record<Forme, number> = { bordeaux: 0, bourgogne: 1, champagne: 2, autre: 3 };
const AUTRE = FORME_INDEX.autre;
/** Indice du type « tout » dans les compteurs d'emplacements (0..2 = types dédiés). */
const TOUT = 3;
const TYPE_INDEX: Record<TypeClayette, number> = { bordeaux: 0, bourgogne: 1, champagne: 2, tout: TOUT };

/**
 * Test de faisabilité exact (théorème de Hall pour cette structure) : `n[f]` bouteilles
 * restantes par forme peuvent-elles toutes être posées sur `m[t]` emplacements restants
 * par type ? Les formes dédiées débordent sur « tout », la forme « autre » n'a que « tout ».
 * Indices : 0 bordeaux, 1 bourgogne, 2 champagne, 3 autre (formes) / tout (types).
 */
export function isFeasible(n: ArrayLike<number>, m: ArrayLike<number>): boolean {
  let need = n[AUTRE]!;
  for (let f = 0; f < AUTRE; f++) need += Math.max(0, n[f]! - m[f]!);
  return need <= m[TOUT]!;
}

/**
 * Bouteilles (classes) de l'arrangement triées : année croissante (sans millésime à la
 * fin) ; à année égale les groupes restent d'un seul tenant, ordonnés selon la variante
 * ('position' : position de lecture moyenne du groupe ; 'alpha' : château) ; dans un
 * groupe, position de lecture courante croissante.
 */
export function sortedSequence(model: ReorgModel, current: Arrangement, variant: Variant): number[] {
  const sum = new Float64Array(model.nGroupes);
  const count = new Int32Array(model.nGroupes);
  const positions: number[] = [];
  for (let j = 0; j < current.length; j++) {
    const c = current[j]!;
    if (c === VIDE) continue;
    const g = model.classes[c]!.groupe;
    sum[g]! += j;
    count[g]! += 1;
    positions.push(j);
  }
  positions.sort((ja, jb) => {
    const a = model.classes[current[ja]!]!;
    const b = model.classes[current[jb]!]!;
    if (a.groupe === b.groupe) return ja - jb;
    const ya = a.annee ?? Infinity;
    const yb = b.annee ?? Infinity;
    if (ya !== yb) return ya < yb ? -1 : 1;
    if (variant === 'position') {
      // Comparaison exacte des moyennes : sa / na < sb / nb ⇔ sa × nb < sb × na.
      const d = sum[a.groupe]! * count[b.groupe]! - sum[b.groupe]! * count[a.groupe]!;
      if (d !== 0) return d;
    }
    // Deux groupes distincts d'une même année ont des châteaux distincts.
    return compareText(a.chateau, b.chateau) || a.groupe - b.groupe;
  });
  return positions.map((j) => current[j]!);
}

export interface CanonicalSequence {
  /** Classes des bouteilles, dans l'ordre de lecture de la cible. */
  sigma: number[];
  /** Placement glouton (solution de repli) : emplacement de chaque élément de σ. */
  greedySlots: number[];
}

/**
 * Glouton sur les emplacements en ordre de lecture.
 * « Candidat » d'un emplacement = première bouteille restante de `sorted` compatible
 * avec lui et dont le retrait laisse un reste faisable.
 *  - 'compact' : poser le candidat s'il existe, sinon laisser vide ;
 *  - 'economique' (ordre strict privilégié) : poser le candidat s'il est du même groupe
 *    que la première bouteille restante ; sinon laisser vide si le reste demeure
 *    faisable ; sinon poser le candidat (exception d'ordre imposée par les types).
 *
 * Note : la règle d'origine exigeait que le candidat SOIT la première bouteille
 * restante. L'élargir à son groupe (même château, même année : aucun effet sur l'ordre
 * des années) rend σ indépendant de l'ordre des bouteilles à l'intérieur d'un groupe,
 * ce qui garantit la convergence de la stabilisation (voir `planTarget`).
 */
export function canonicalSequence(model: ReorgModel, sorted: readonly number[], mode: ReorgMode): CanonicalSequence {
  // Files d'attente par forme (indices dans `sorted`, croissants).
  const queues: number[][] = FORMES.map(() => []);
  sorted.forEach((c, i) => queues[FORME_INDEX[model.classes[c]!.forme]]!.push(i));
  const head = [0, 0, 0, 0];
  const n = queues.map((q) => q.length);
  const m = [0, 0, 0, 0];
  for (const slot of model.slots) m[TYPE_INDEX[slot.type]]! += 1;
  if (!isFeasible(n, m)) {
    throw new Error('Réorganisation impossible : les bouteilles ne tiennent pas dans la cave.');
  }
  const groupAt = (i: number): number => model.classes[sorted[i]!]!.groupe;

  const sigma: number[] = [];
  const greedySlots: number[] = [];
  let remaining = sorted.length;
  for (let j = 0; j < model.slots.length && remaining > 0; j++) {
    const t = TYPE_INDEX[model.slots[j]!.type];
    m[t]! -= 1;
    // `first` : première bouteille restante ; `candidate` : première compatible et faisable.
    let candidate = -1;
    let candidateForme = -1;
    let first = -1;
    for (let f = 0; f < FORMES.length; f++) {
      if (n[f] === 0) continue;
      const i = queues[f]![head[f]!]!;
      if (first === -1 || i < first) first = i;
      if (t !== TOUT && t !== f) continue;
      if (candidate !== -1 && i > candidate) continue;
      n[f]! -= 1;
      if (isFeasible(n, m)) {
        candidate = i;
        candidateForme = f;
      }
      n[f]! += 1;
    }
    if (candidate === -1) {
      if (!isFeasible(n, m)) throw new Error('Réorganisation : incohérence interne du test de faisabilité.');
      continue;
    }
    if (mode === 'economique' && groupAt(candidate) !== groupAt(first) && isFeasible(n, m)) continue;
    head[candidateForme]! += 1;
    n[candidateForme]! -= 1;
    remaining -= 1;
    sigma.push(sorted[candidate]!);
    greedySlots.push(j);
  }
  return { sigma, greedySlots };
}

/* ------------------------------------------------------------------ */
/* B. Placement par programmation dynamique                            */
/* ------------------------------------------------------------------ */

/**
 * Score entier d'un placement (emplacements strictement croissants) de σ :
 *   fix × (bouteilles posées là où se trouve déjà une bouteille identique)
 *   − empty × (emplacements vides avant la dernière bouteille)
 *   − hole × (emplacements vides suivis d'une bouteille sur la même clayette)
 *   − Σ sur les voisins σ(i−1), σ(i) d'un même groupe : split si clayettes différentes,
 *     gap si même clayette sans être adjacents.
 * Renvoie `-Infinity` si le placement n'est pas valide (ordre ou type de clayette).
 */
export function placementScore(
  model: ReorgModel,
  current: Arrangement,
  sigma: readonly number[],
  slotsOf: ArrayLike<number>,
  w: IntWeights,
): number {
  let score = 0;
  for (let i = 0; i < sigma.length; i++) {
    const c = sigma[i]!;
    const j = slotsOf[i]!;
    const prev = i > 0 ? slotsOf[i - 1]! : -1;
    if (j <= prev || j >= model.slots.length || !classFits(model, c, j)) return -Infinity;
    if (current[j] === c) score += w.fix;
    score -= w.empty * (j - prev - 1);
    score -= w.hole * (j - Math.max(prev + 1, model.shelfStart[j]!));
    if (i > 0 && model.classes[c]!.groupe === model.classes[sigma[i - 1]!]!.groupe) {
      if (model.shelfStart[j] !== model.shelfStart[prev]) score -= w.split;
      else if (j !== prev + 1) score -= w.gap;
    }
  }
  return score;
}

/**
 * Place σ sur les emplacements en maximisant `placementScore` : la i-ème bouteille va
 * sur un emplacement compatible situé strictement après celui de la (i−1)-ème.
 * Programmation dynamique en O(M × N) : pour chaque bouteille, le meilleur prédécesseur
 * se lit dans des maxima préfixes (clayettes précédentes / clayette courante).
 *
 * À score égal, la solution retenue est la plus « haute / gauche » : la dernière
 * bouteille est le plus haut possible, puis l'avant-dernière, etc.
 * Renvoie l'emplacement de chaque élément de σ, ou `null` si aucun placement n'existe.
 */
export function alignSequence(
  model: ReorgModel,
  current: Arrangement,
  sigma: readonly number[],
  w: IntWeights,
): Int32Array | null {
  const N = sigma.length;
  const M = model.slots.length;
  if (N === 0) return new Int32Array(0);
  if (N > M) return null;
  const { classes, shelfStart } = model;
  const E = w.empty;
  const EH = w.empty + w.hole;

  // back[i × M + j] = emplacement de σ(i−1) dans la meilleure solution où σ(i) est en j.
  const back = new Int32Array(N * M).fill(-1);
  // prevRow[k] = meilleur score des i premières bouteilles, la dernière étant en k.
  let prevRow = new Float64Array(M);
  let row = new Float64Array(M);

  const c0 = sigma[0]!;
  for (let j = 0; j < M; j++) {
    prevRow[j] = classFits(model, c0, j)
      ? (current[j] === c0 ? w.fix : 0) - E * j - w.hole * (j - shelfStart[j]!)
      : -Infinity;
  }

  for (let i = 1; i < N; i++) {
    const c = sigma[i]!;
    const sameGroup = classes[c]!.groupe === classes[sigma[i - 1]!]!.groupe;
    const splitCost = sameGroup ? w.split : 0;
    const gapCost = sameGroup ? w.gap : 0;
    const base = i * M;
    // Le coût des vides entre le prédécesseur k et j est linéaire en k : on cherche donc
    // le maximum de prevRow[k] + coût × k (premier indice atteignant le maximum) sur
    //  - les k des clayettes précédentes (vides au tarif E) ;
    //  - les k de la clayette courante jusqu'à j − 2 (vides = trous, tarif E + hole).
    let allMax = -Infinity;
    let allArg = -1;
    let beforeMax = -Infinity;
    let beforeArg = -1;
    let inMax = -Infinity;
    let inArg = -1;
    for (let j = 0; j < M; j++) {
      const start = shelfStart[j]!;
      if (j === start) {
        beforeMax = allMax;
        beforeArg = allArg;
        inMax = -Infinity;
        inArg = -1;
      } else if (j - 2 >= start) {
        const v = prevRow[j - 2]! + EH * (j - 2);
        if (v > inMax) {
          inMax = v;
          inArg = j - 2;
        }
      }
      if (classFits(model, c, j)) {
        // Du plus petit k au plus grand : à égalité, le prédécesseur le plus haut gagne.
        let val = -Infinity;
        let arg = -1;
        if (beforeArg !== -1) {
          val = beforeMax - E * (j - 1) - w.hole * (j - start) - splitCost;
          arg = beforeArg;
        }
        if (inArg !== -1) {
          const v = inMax - EH * (j - 1) - gapCost;
          if (v > val) {
            val = v;
            arg = inArg;
          }
        }
        if (j - 1 >= start && prevRow[j - 1]! > val) {
          val = prevRow[j - 1]!;
          arg = j - 1;
        }
        row[j] = arg === -1 ? -Infinity : (current[j] === c ? w.fix : 0) + val;
        back[base + j] = arg;
      } else {
        row[j] = -Infinity;
      }
      const v = prevRow[j]! + E * j;
      if (v > allMax) {
        allMax = v;
        allArg = j;
      }
    }
    const tmp = prevRow;
    prevRow = row;
    row = tmp;
  }

  let end = -1;
  let best = -Infinity;
  for (let j = 0; j < M; j++) {
    if (prevRow[j]! > best) {
      best = prevRow[j]!;
      end = j;
    }
  }
  if (end === -1) return null;
  const slotsOf = new Int32Array(N);
  let j = end;
  for (let i = N - 1; i >= 0; i--) {
    slotsOf[i] = j;
    if (i > 0) j = back[i * M + j]!;
  }
  return slotsOf;
}

/* ------------------------------------------------------------------ */
/* C. Variantes et stabilisation                                       */
/* ------------------------------------------------------------------ */

/** Cible calculée pour une variante, avec les critères de choix. */
export interface Candidate {
  variant: Variant;
  target: Arrangement;
  /** Nombre minimal de déplacements depuis l'arrangement de départ. */
  moves: number;
  exceptionsOrdre: number;
  groupesSepares: number;
}

/** Cible d'une variante : σ puis placement optimal (repli sur le placement glouton). */
export function planVariant(model: ReorgModel, current: Arrangement, mode: ReorgMode, variant: Variant): Candidate {
  const { sigma, greedySlots } = canonicalSequence(model, sortedSequence(model, current, variant), mode);
  const weights = integerWeights(mode, sigma.length, model.slots.length);
  const slotsOf = alignSequence(model, current, sigma, weights) ?? greedySlots;
  const target = new Int32Array(current.length).fill(VIDE);
  sigma.forEach((c, i) => {
    target[slotsOf[i]!] = c;
  });
  return {
    variant,
    target,
    moves: countMoves(current, target, model.classes.length),
    exceptionsOrdre: countOrderExceptions(model, target),
    groupesSepares: countSplitGroups(model, target),
  };
}

/** Ordre de préférence : moins de déplacements, puis d'exceptions d'ordre, puis de groupes séparés. */
export function compareCandidates(a: Candidate, b: Candidate): number {
  return a.moves - b.moves || a.exceptionsOrdre - b.exceptionsOrdre || a.groupesSepares - b.groupesSepares;
}

/** Meilleure cible parmi les variantes (à égalité : la première, 'position'). */
export function planOnce(model: ReorgModel, current: Arrangement, mode: ReorgMode): Candidate {
  const [position, alpha] = VARIANTS.map((variant) => planVariant(model, current, mode, variant)) as [
    Candidate,
    Candidate,
  ];
  return compareCandidates(alpha, position) < 0 ? alpha : position;
}

export interface TargetPlan {
  target: Arrangement;
  /** `false` si la limite d'itérations a été atteinte avant d'obtenir un point fixe. */
  stable: boolean;
  /** Nombre de replanifications effectuées pendant la stabilisation. */
  iterations: number;
}

/**
 * Cible STABILISÉE : on replanifie à partir de la cible obtenue tant que cela produit
 * encore des déplacements (au plus `MAX_STABILISATION` fois). La cible renvoyée est
 * alors un point fixe : `planOnce(cible)` ne demande aucun déplacement.
 *
 * Convergence : avec la variante 'alpha', σ ne dépend plus de l'arrangement une fois
 * celui-ci produit par le planificateur (voir `canonicalSequence`) ; chaque
 * replanification qui déplace encore des bouteilles réduit alors strictement les
 * pénalités de vides et de groupes, donc la suite s'arrête. La variante 'position'
 * n'offre pas cette garantie (la position moyenne des groupes bouge quand le type des
 * clayettes disperse les bouteilles) : au-delà de `FREE_STABILISATION` itérations, on
 * n'adopte plus que la cible 'alpha'.
 */
export function planTarget(model: ReorgModel, current: Arrangement, mode: ReorgMode): TargetPlan {
  let target = planOnce(model, current, mode).target;
  for (let iterations = 1; iterations <= MAX_STABILISATION; iterations++) {
    const [position, alpha] = VARIANTS.map((variant) => planVariant(model, target, mode, variant)) as [
      Candidate,
      Candidate,
    ];
    if (position.moves === 0 || alpha.moves === 0) return { target, stable: true, iterations };
    target =
      iterations > FREE_STABILISATION || compareCandidates(alpha, position) < 0 ? alpha.target : position.target;
  }
  return { target, stable: false, iterations: MAX_STABILISATION };
}
