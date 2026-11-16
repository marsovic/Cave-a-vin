import { allSlots, bottleAt, isCompatible, isValidSlot, occupancy, slotKey } from './cellar';
import { FORME_LABELS, TYPE_CLAYETTE_LABELS, formatSlot, formatWine } from './labels';
import { groupKey } from './normalize';
import type { Bottle, Cellar, SlotRef, WineFields } from './types';

/** Proposition d'emplacements pour ranger de nouvelles bouteilles. */
export interface PlacementSuggestion {
  /** Emplacements proposés (libres, compatibles), au plus `count`. */
  slots: SlotRef[];
  /** `true` si `count` emplacements ont été trouvés. */
  complete: boolean;
  /** Explication courte en français (pourquoi ces emplacements, ou pourquoi il en manque). */
  message: string;
}

type Wine = Pick<WineFields, 'chateau' | 'annee' | 'forme'>;

interface Candidate {
  slot: SlotRef;
  /** Position dans l'ordre de lecture de la cave. */
  index: number;
  score: number;
  /** Nombre de voisines immédiates du même groupe (même château + même année). */
  twins: number;
  /** Le groupe est présent ailleurs sur la même clayette. */
  sameShelfGroup: boolean;
  /** Années des bouteilles voisines dans l'ordre de lecture (`undefined` : pas de voisine). */
  before: number | null | undefined;
  after: number | null | undefined;
  ordered: boolean;
  specialized: boolean;
}

const SCORE = {
  twin: 100,
  sameShelfGroup: 40,
  ordered: 30,
  halfOrdered: 12,
  closeYear: 10,
  specialized: 8,
  contiguous: 60,
} as const;

/** Année pour les comparaisons : les bouteilles sans millésime se rangent en fin de cave. */
function yearRank(annee: number | null): number {
  return annee ?? Number.POSITIVE_INFINITY;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n > 1 ? many : one}`;
}

function buildCandidates(cellar: Cellar, wine: Wine): Candidate[] {
  const occ = occupancy(cellar);
  const slots = allSlots(cellar);
  const group = groupKey(wine);
  const y = yearRank(wine.annee);

  // Année de la bouteille occupée la plus proche avant / après chaque emplacement.
  const prevYear: (number | null | undefined)[] = [];
  let last: number | null | undefined;
  for (const slot of slots) {
    prevYear.push(last);
    const b = occ.get(slotKey(slot));
    if (b) last = b.annee;
  }
  const nextYear: (number | null | undefined)[] = new Array(slots.length);
  let next: number | null | undefined;
  for (let i = slots.length - 1; i >= 0; i--) {
    nextYear[i] = next;
    const b = occ.get(slotKey(slots[i]!));
    if (b) next = b.annee;
  }

  const groupShelves = new Set<number>();
  for (const b of cellar.bottles) if (groupKey(b) === group) groupShelves.add(b.clayette);

  const out: Candidate[] = [];
  slots.forEach((slot, index) => {
    if (occ.has(slotKey(slot))) return;
    const shelf = cellar.shelves[slot.clayette - 1]!;
    if (!isCompatible(wine.forme, shelf.type)) return;

    const neighbours: (Bottle | undefined)[] = [
      occ.get(slotKey({ clayette: slot.clayette, rang: slot.rang - 1 })),
      occ.get(slotKey({ clayette: slot.clayette, rang: slot.rang + 1 })),
    ];
    const twins = neighbours.filter((b) => b && groupKey(b) === group).length;
    const sameShelfGroup = groupShelves.has(slot.clayette);

    const before = prevYear[index];
    const after = nextYear[index];
    const okBefore = before === undefined || yearRank(before) <= y;
    const okAfter = after === undefined || y <= yearRank(after);
    const ordered = okBefore && okAfter;

    let score = twins * SCORE.twin;
    if (sameShelfGroup) score += SCORE.sameShelfGroup;
    if (ordered) {
      score += SCORE.ordered;
      // Plus les millésimes voisins sont proches, mieux c'est.
      const gaps: number[] = [];
      if (before !== undefined && Number.isFinite(y) && before !== null) gaps.push(y - before);
      if (after !== undefined && Number.isFinite(y) && after !== null) gaps.push(after - y);
      if (gaps.length > 0) score += Math.max(0, SCORE.closeYear - Math.min(...gaps));
    } else if (okBefore || okAfter) {
      score += SCORE.halfOrdered;
    }
    const specialized = shelf.type !== 'tout';
    if (specialized) score += SCORE.specialized;
    // À égalité : le plus haut, puis le plus à gauche.
    score -= index / (slots.length * 10);

    out.push({ slot, index, score, twins, sameShelfGroup, before, after, ordered, specialized });
  });
  return out;
}

function explain(c: Candidate, cellar: Cellar, wine: Wine): string {
  if (c.twins > 0) {
    return `À côté ${c.twins > 1 ? 'de bouteilles' : 'd\'une bouteille'} du même vin.`;
  }
  if (c.sameShelfGroup) return `Sur la clayette ${c.slot.clayette}, avec les autres bouteilles du même vin.`;
  if (c.ordered && wine.annee !== null && (typeof c.before === 'number' || typeof c.after === 'number')) {
    if (typeof c.before === 'number' && typeof c.after === 'number') {
      return c.before === c.after
        ? `Sur la clayette ${c.slot.clayette}, parmi les millésimes ${c.before}.`
        : `Sur la clayette ${c.slot.clayette}, entre les millésimes ${c.before} et ${c.after}.`;
    }
    if (typeof c.before === 'number') return `Sur la clayette ${c.slot.clayette}, après le millésime ${c.before}.`;
    return `Sur la clayette ${c.slot.clayette}, avant le millésime ${c.after}.`;
  }
  const type = cellar.shelves[c.slot.clayette - 1]!.type;
  if (c.specialized) return `Première place convenable sur une clayette ${TYPE_CLAYETTE_LABELS[type]}.`;
  return 'Première place libre compatible.';
}

/** Meilleure suite de `length` emplacements adjacents sur une même clayette, parmi `pool`. */
function bestRun(pool: Candidate[], length: number): Candidate[] | null {
  const byKey = new Map(pool.map((c) => [slotKey(c.slot), c]));
  let best: Candidate[] | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const start of pool) {
    const run: Candidate[] = [start];
    for (let k = 1; k < length; k++) {
      const next = byKey.get(slotKey({ clayette: start.slot.clayette, rang: start.slot.rang + k }));
      if (!next) break;
      run.push(next);
    }
    if (run.length < length) continue;
    const score = run.reduce((sum, c) => sum + c.score, 0);
    if (score > bestScore) {
      bestScore = score;
      best = run;
    }
  }
  return best;
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
  wine: Wine,
  count: number,
  prefer: { clayette?: number; rang?: number } = {},
): PlacementSuggestion {
  const wanted = Math.max(1, Math.floor(count));
  const forme = FORME_LABELS[wine.forme];
  const all = buildCandidates(cellar, wine);

  // Emplacement précis désigné par l'utilisateur.
  if (prefer.clayette !== undefined && prefer.rang !== undefined) {
    const slot = { clayette: prefer.clayette, rang: prefer.rang };
    if (!isValidSlot(cellar, slot)) {
      return { slots: [], complete: false, message: `L'emplacement ${formatSlot(slot)} n'existe pas dans la cave.` };
    }
    const occupant = bottleAt(cellar, slot);
    if (occupant) {
      return {
        slots: [],
        complete: false,
        message: `L'emplacement ${formatSlot(slot)} est déjà occupé par ${formatWine(occupant)}.`,
      };
    }
    const shelf = cellar.shelves[slot.clayette - 1]!;
    if (!isCompatible(wine.forme, shelf.type)) {
      return {
        slots: [],
        complete: false,
        message: `Une bouteille de forme ${forme} ne peut pas aller sur la clayette ${slot.clayette} (emplacements ${TYPE_CLAYETTE_LABELS[shelf.type]}).`,
      };
    }
    // On part de ce rang et on continue vers la droite (en sautant les emplacements occupés).
    const onShelf = all
      .filter((c) => c.slot.clayette === slot.clayette && c.slot.rang >= slot.rang)
      .sort((a, b) => a.slot.rang - b.slot.rang)
      .slice(0, wanted);
    const slots = onShelf.map((c) => c.slot);
    const complete = slots.length === wanted;
    return {
      slots,
      complete,
      message: complete
        ? wanted === 1
          ? 'Emplacement que vous avez désigné.'
          : `À partir de l'emplacement que vous avez désigné, vers la droite.`
        : `Seulement ${plural(slots.length, 'place libre', 'places libres')} à partir de cet emplacement pour ${wanted} bouteilles.`,
    };
  }

  let pool = all;
  let scope = '';
  if (prefer.clayette !== undefined) {
    const shelf = cellar.shelves[prefer.clayette - 1];
    if (!shelf) {
      return { slots: [], complete: false, message: `La clayette ${prefer.clayette} n'existe pas.` };
    }
    if (!isCompatible(wine.forme, shelf.type)) {
      return {
        slots: [],
        complete: false,
        message: `Une bouteille de forme ${forme} ne peut pas aller sur la clayette ${prefer.clayette} (emplacements ${TYPE_CLAYETTE_LABELS[shelf.type]}).`,
      };
    }
    pool = pool.filter((c) => c.slot.clayette === prefer.clayette);
    scope = ` sur la clayette ${prefer.clayette}`;
  }
  if (prefer.rang !== undefined) {
    pool = pool.filter((c) => c.slot.rang === prefer.rang);
    scope += ` au rang ${prefer.rang}`;
  }

  if (pool.length === 0) {
    const anyFree = allSlots(cellar).length - cellar.bottles.length;
    let message: string;
    if (anyFree === 0) message = 'La cave est pleine : aucune place libre.';
    else if (all.length === 0) message = `Aucune place libre compatible avec une bouteille de forme ${forme}.`;
    else message = `Aucune place libre compatible${scope}.`;
    return { slots: [], complete: false, message };
  }

  if (wanted === 1) {
    const best = pool.reduce((a, b) => (b.score > a.score ? b : a));
    return { slots: [best.slot], complete: true, message: explain(best, cellar, wine) };
  }

  // Plusieurs bouteilles : on cherche d'abord une suite contiguë sur une même clayette,
  // puis des suites de plus en plus courtes pour celles qui restent.
  const chosen: Candidate[] = [];
  let remaining = [...pool];
  let runs = 0;
  while (chosen.length < wanted && remaining.length > 0) {
    let run: Candidate[] | null = null;
    for (let length = wanted - chosen.length; length >= 1 && !run; length--) run = bestRun(remaining, length);
    if (!run) break;
    runs += 1;
    chosen.push(...run);
    const taken = new Set(run.map((c) => slotKey(c.slot)));
    remaining = remaining.filter((c) => !taken.has(slotKey(c.slot)));
  }
  chosen.sort((a, b) => a.index - b.index);
  const slots = chosen.map((c) => c.slot);
  if (slots.length < wanted) {
    return {
      slots,
      complete: false,
      message: `Seulement ${plural(slots.length, 'place libre compatible', 'places libres compatibles')}${scope} pour ${wanted} bouteilles.`,
    };
  }
  const first = chosen[0]!;
  const message =
    runs === 1
      ? first.twins > 0 || chosen.some((c) => c.twins > 0)
        ? `${wanted} places côte à côte, près des bouteilles du même vin.`
        : `${wanted} places côte à côte sur la clayette ${first.slot.clayette}.`
      : `Pas assez de places côte à côte : les ${wanted} bouteilles sont réparties sur ${runs} endroits.`;
  return { slots, complete: true, message };
}
