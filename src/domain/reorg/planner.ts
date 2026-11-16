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
export const MAX_STABILISATION = 8;

/** Nombre de replanifications où les deux variantes restent en concurrence (voir `planTarget`). */
export const FREE_STABILISATION = 2;

/**
 * Variantes d'ordre des groupes d'une même année :
 *  - 'position' : position moyenne actuelle du groupe ;
 *  - 'mediane' : position médiane (insensible à une bouteille isolée loin de son lot) ;
 *  - 'disperses' : les lots déjà d'un seul tenant gardent leur ordre, les lots dispersés — qu'il
 *    faudra déplacer de toute façon — passent après eux (on ne décale pas toute une clayette
 *    pour une bouteille ajoutée à un lot) ;
 *  - 'alpha' : ordre alphabétique des châteaux, indépendant de l'arrangement.
 */
export const VARIANTS = ['position', 'mediane', 'disperses', 'alpha'] as const;
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
  const members: number[][] = Array.from({ length: model.nGroupes }, () => []);
  for (let j = 0; j < current.length; j++) {
    const c = current[j]!;
    if (c === VIDE) continue;
    const g = model.classes[c]!.groupe;
    sum[g]! += j;
    count[g]! += 1;
    members[g]!.push(j);
    positions.push(j);
  }
  // Médiane (basse) des positions de chaque groupe ; les positions sont déjà croissantes.
  const median = members.map((list) => (list.length > 0 ? list[(list.length - 1) >> 1]! : 0));
  // Lot dispersé : ses bouteilles ne sont pas côte à côte sur une même clayette.
  const scattered = members.map((list) =>
    list.some((j, k) => k > 0 && (j !== list[k - 1]! + 1 || model.shelfStart[j] !== model.shelfStart[list[k - 1]!])),
  );
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
    } else if (variant === 'mediane') {
      const d = median[a.groupe]! - median[b.groupe]!;
      if (d !== 0) return d;
    } else if (variant === 'disperses') {
      const d =
        Number(scattered[a.groupe]) - Number(scattered[b.groupe]) ||
        sum[a.groupe]! * count[b.groupe]! - sum[b.groupe]! * count[a.groupe]!;
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
 * Glouton sur les emplacements en ordre de lecture, identique dans les deux modes (ils ne
 * diffèrent que par les poids du placement) : l'ordre des années passe avant le remplissage.
 *
 * À chaque emplacement, les bouteilles posables sont les premières restantes de chaque forme
 * compatible dont le retrait laisse un reste faisable. On retient la première dans `sorted`,
 * avec deux raffinements :
 *  - à année égale et sur un emplacement « tout », on préfère la forme dont le prochain
 *    emplacement compatible est le plus lointain : elle n'aura pas d'autre place sans passer
 *    après des millésimes plus récents (les autres trouveront leur clayette dédiée) ;
 *  - on ne change pas de vin au milieu d'un lot : le groupe de la dernière bouteille posée
 *    continue tant qu'il lui reste des bouteilles posables.
 * La bouteille retenue est posée si elle a l'année de la première bouteille restante (aucune
 * entorse à l'ordre) ou si elle continue le groupe en cours ; sinon l'emplacement reste vide
 * tant que le reste demeure faisable, et n'est rempli qu'en dernier recours (exception
 * d'ordre imposée par les types).
 *
 * σ ne dépend pas de l'ordre des bouteilles à l'intérieur d'un groupe, ce qui aide la
 * stabilisation à converger (voir `planTarget`).
 */
export function canonicalSequence(model: ReorgModel, sorted: readonly number[], _mode?: ReorgMode): CanonicalSequence {
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
  const yearAt = (i: number): number => model.classes[sorted[i]!]!.annee ?? Infinity;

  // nextFit[f][j] : premier emplacement d'indice > j compatible avec la forme f (Infinity si aucun).
  const nSlots = model.slots.length;
  const nextFit: Float64Array[] = FORMES.map(() => new Float64Array(nSlots).fill(Infinity));
  const upcoming = [Infinity, Infinity, Infinity, Infinity];
  for (let j = nSlots - 1; j >= 0; j--) {
    for (let f = 0; f < FORMES.length; f++) nextFit[f]![j] = upcoming[f]!;
    const t = TYPE_INDEX[model.slots[j]!.type];
    for (let f = 0; f < FORMES.length; f++) if (t === TOUT || t === f) upcoming[f] = j;
  }

  const sigma: number[] = [];
  const greedySlots: number[] = [];
  let remaining = sorted.length;
  let lastGroup = -1;
  for (let j = 0; j < nSlots && remaining > 0; j++) {
    const t = TYPE_INDEX[model.slots[j]!.type];
    m[t]! -= 1;
    // `first` : première bouteille restante ; `options` : têtes de file posables ici.
    let first = -1;
    const options: { i: number; f: number }[] = [];
    for (let f = 0; f < FORMES.length; f++) {
      if (n[f] === 0) continue;
      const i = queues[f]![head[f]!]!;
      if (first === -1 || i < first) first = i;
      if (t !== TOUT && t !== f) continue;
      n[f]! -= 1;
      if (isFeasible(n, m)) options.push({ i, f });
      n[f]! += 1;
    }
    if (options.length === 0) {
      if (!isFeasible(n, m)) throw new Error('Réorganisation : incohérence interne du test de faisabilité.');
      continue;
    }
    let chosen = options.reduce((a, b) => (b.i < a.i ? b : a));
    const continuing = options
      .filter((o) => groupAt(o.i) === lastGroup)
      .reduce<{ i: number; f: number } | undefined>((a, b) => (!a || b.i < a.i ? b : a), undefined);
    if (continuing) {
      chosen = continuing;
    } else {
      const year = yearAt(chosen.i);
      for (const o of options) {
        if (yearAt(o.i) !== year) continue;
        const far = nextFit[o.f]![j]!;
        const best = nextFit[chosen.f]![j]!;
        if (far > best || (far === best && o.i < chosen.i)) chosen = o;
      }
    }
    const inOrder = yearAt(chosen.i) === yearAt(first);
    if (!inOrder && !continuing && isFeasible(n, m)) continue;
    head[chosen.f]! += 1;
    n[chosen.f]! -= 1;
    remaining -= 1;
    lastGroup = groupAt(chosen.i);
    sigma.push(sorted[chosen.i]!);
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

/**
 * Dans chaque groupe (même château + même année), redistribue les bouteilles de MÊME FORME sur
 * les emplacements que la cible leur attribue, de façon à laisser en place celles qui s'y
 * trouvent déjà. L'ordre interne d'un lot n'a aucune importance pour le rangement : inutile
 * d'échanger deux bouteilles voisines parce qu'elles diffèrent par le statut « collection »
 * ou les cépages saisis. On ne permute qu'à forme égale : la suite des formes dans l'ordre de
 * lecture — dont dépendent la faisabilité et la stabilité du plan — reste inchangée.
 */
export function keepGroupMembersInPlace(model: ReorgModel, current: Arrangement, target: Arrangement): Arrangement {
  const out = Int32Array.from(target);
  const buckets = new Map<string, number[]>();
  for (let j = 0; j < target.length; j++) {
    const c = target[j]!;
    if (c === VIDE) continue;
    const info = model.classes[c]!;
    const key = `${info.groupe}|${info.forme}`;
    const list = buckets.get(key);
    if (list) list.push(j);
    else buckets.set(key, [j]);
  }
  for (const slots of buckets.values()) {
    if (slots.length < 2) continue;
    const remaining = new Map<number, number>();
    for (const j of slots) remaining.set(target[j]!, (remaining.get(target[j]!) ?? 0) + 1);
    if (remaining.size < 2) continue; // bouteilles toutes identiques : rien à gagner

    // 1. Une bouteille du lot déjà posée sur un des emplacements du lot y reste.
    const open: number[] = [];
    for (const j of slots) {
      const c = current[j]!;
      const left = c === VIDE ? 0 : (remaining.get(c) ?? 0);
      if (left > 0) {
        out[j] = c;
        remaining.set(c, left - 1);
      } else {
        open.push(j);
      }
    }
    // 2. Les autres emplacements reçoivent les bouteilles restantes, dans l'ordre d'origine.
    const rest: number[] = [];
    for (const j of slots) {
      const c = target[j]!;
      const left = remaining.get(c) ?? 0;
      if (left > 0) {
        rest.push(c);
        remaining.set(c, left - 1);
      }
    }
    open.forEach((j, i) => {
      out[j] = rest[i]!;
    });
  }
  return out;
}

/** Cible d'une variante : σ puis placement optimal (repli sur le placement glouton). */
export function planVariant(model: ReorgModel, current: Arrangement, mode: ReorgMode, variant: Variant): Candidate {
  const { sigma, greedySlots } = canonicalSequence(model, sortedSequence(model, current, variant), mode);
  const weights = integerWeights(mode, sigma.length, model.slots.length);
  const slotsOf = alignSequence(model, current, sigma, weights) ?? greedySlots;
  const aligned = new Int32Array(current.length).fill(VIDE);
  sigma.forEach((c, i) => {
    aligned[slotsOf[i]!] = c;
  });
  const target = keepGroupMembersInPlace(model, current, aligned);
  return {
    variant,
    target,
    moves: countMoves(current, target, model.classes.length),
    exceptionsOrdre: countOrderExceptions(model, target),
    groupesSepares: countSplitGroups(model, target),
  };
}

/**
 * Ordre de préférence entre deux cibles : d'abord la qualité du tri (moins d'exceptions à
 * l'ordre des années), puis le coût global — déplacements et lots séparés, un lot séparé
 * « valant » W_SPLIT déplacements comme dans le placement —, puis le nombre de déplacements.
 */
export function compareCandidates(a: Candidate, b: Candidate): number {
  const cost = (c: Candidate): number => 2 * c.moves + 5 * c.groupesSepares; // = 2 × (moves + 2,5 × lots)
  return a.exceptionsOrdre - b.exceptionsOrdre || cost(a) - cost(b) || a.moves - b.moves;
}

/** Meilleure cible parmi les variantes (à égalité : la première de `VARIANTS`). */
export function planOnce(model: ReorgModel, current: Arrangement, mode: ReorgMode): Candidate {
  let best: Candidate | null = null;
  for (const variant of VARIANTS) {
    const candidate = planVariant(model, current, mode, variant);
    if (!best || compareCandidates(candidate, best) < 0) best = candidate;
  }
  return best!;
}

export interface TargetPlan {
  target: Arrangement;
  /** `false` si la limite d'itérations a été atteinte avant d'obtenir un point fixe. */
  stable: boolean;
  /** Nombre de replanifications effectuées pendant la stabilisation. */
  iterations: number;
}

/**
 * Cible STABILISÉE : on replanifie à partir de la cible obtenue tant que cela produit encore
 * des déplacements (au plus `MAX_STABILISATION` fois). La cible renvoyée est alors un point
 * fixe du planificateur : `planOnce(cible)` ne demande aucun déplacement, donc relancer la
 * réorganisation sur une cave fraîchement rangée ne propose plus rien.
 *
 * Les replanifications libres convergent presque toujours en une ou deux passes. Par sécurité,
 * au-delà de `FREE_STABILISATION` passes, on n'adopte plus que la cible de la variante
 * 'alpha', dont l'ordre σ ne dépend pas de l'arrangement de départ.
 */
export function planTarget(model: ReorgModel, current: Arrangement, mode: ReorgMode): TargetPlan {
  let target = planOnce(model, current, mode).target;
  // Les replanifications successives raisonnent sur des cibles intermédiaires : à la fin, on
  // rapproche de nouveau l'ordre interne des lots de la cave RÉELLE de départ.
  const settle = (t: Arrangement): Arrangement => keepGroupMembersInPlace(model, current, t);
  for (let iterations = 1; iterations <= MAX_STABILISATION; iterations++) {
    const next = planOnce(model, target, mode);
    if (next.moves === 0) return { target: settle(target), stable: true, iterations };
    target = iterations > FREE_STABILISATION ? planVariant(model, target, mode, 'alpha').target : next.target;
  }
  return { target: settle(target), stable: false, iterations: MAX_STABILISATION };
}
