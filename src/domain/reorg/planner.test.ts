import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { isCompatible } from '../cellar';
import { FORMES, TYPES_CLAYETTE, type Cellar, type Forme, type TypeClayette } from '../types';
import { buildModel, classFits, VIDE, type ReorgModel } from './model';
import {
  alignSequence,
  canonicalSequence,
  integerWeights,
  isFeasible,
  LEXICOGRAPHIC,
  MAX_STABILISATION,
  placementScore,
  planOnce,
  planTarget,
  planVariant,
  REORG_WEIGHTS,
  sortedSequence,
  VARIANTS,
  WEIGHTS_COMPACT,
  WEIGHTS_ECONOMIQUE,
} from './planner';
import { arbCellar, cellarFromRows, w } from './testkit';
import type { ReorgMode } from './types';

const MODES: readonly ReorgMode[] = ['economique', 'compact'];

/** « Château année » de chaque classe d'une séquence (lisible dans les attentes). */
function names(cellar: Cellar, model: ReorgModel, sequence: readonly number[]): string[] {
  return sequence.map((c) => {
    const key = model.classes[c]!.key;
    const bottle = cellar.bottles.find((b) => buildModel({ shelves: cellar.shelves, bottles: [b] }).model.classes[0]!.key === key)!;
    return `${bottle.chateau}${bottle.annee === null ? '' : ` ${bottle.annee}`}`;
  });
}

describe('poids', () => {
  it('expose les constantes du cahier des charges', () => {
    expect(WEIGHTS_ECONOMIQUE).toEqual({ W_FIX: 1, W_EMPTY: 0, W_SPLIT: 2.5, W_GAP: 4 });
    expect(WEIGHTS_COMPACT).toEqual({ W_FIX: 0.2, W_EMPTY: 1, W_SPLIT: 2.5, W_GAP: 4 });
    expect(REORG_WEIGHTS.economique).toBe(WEIGHTS_ECONOMIQUE);
    expect(REORG_WEIGHTS.compact).toBe(WEIGHTS_COMPACT);
    expect(LEXICOGRAPHIC).toEqual({ economique: false, compact: true });
    expect(MAX_STABILISATION).toBe(8);
  });

  it('mode économique : entiers proportionnels aux poids, sans coût de trou', () => {
    expect(integerWeights('economique', 37, 120)).toEqual({ fix: 10, empty: 0, hole: 0, split: 25, gap: 40 });
  });

  it('mode compact : priorités strictes vides/groupes > trous > bouteilles en place', () => {
    for (const [n, m] of [[1, 1], [5, 12], [600, 600]] as const) {
      const iw = integerWeights('compact', n, m);
      // Toutes les bouteilles en place pèsent moins qu'un seul trou…
      expect(n * iw.fix).toBeLessThan(iw.hole);
      // … et tous les trous + bouteilles en place moins qu'un demi-vide (plus petit écart possible).
      expect(m * iw.hole + n * iw.fix).toBeLessThan(iw.empty / 2);
      expect(iw.split / iw.empty).toBe(2.5);
      expect(iw.gap / iw.empty).toBe(4);
    }
  });
});

describe('isFeasible — comptage de Hall', () => {
  it('cas simples', () => {
    //              bdx bgn chp autre     bdx bgn chp tout
    expect(isFeasible([0, 0, 0, 0], [0, 0, 0, 0])).toBe(true);
    expect(isFeasible([2, 0, 0, 0], [2, 0, 0, 0])).toBe(true);
    expect(isFeasible([3, 0, 0, 0], [2, 0, 0, 0])).toBe(false);
    expect(isFeasible([3, 0, 0, 0], [2, 5, 5, 1])).toBe(true);
    expect(isFeasible([0, 0, 0, 1], [9, 9, 9, 0])).toBe(false);
    expect(isFeasible([3, 2, 0, 1], [2, 1, 0, 3])).toBe(true);
    expect(isFeasible([3, 2, 0, 2], [2, 1, 0, 3])).toBe(false);
  });

  it('équivaut à l\'existence d\'un couplage parfait bouteilles → emplacements', () => {
    const counts = fc.array(fc.integer({ min: 0, max: 3 }), { minLength: 4, maxLength: 4 });
    fc.assert(
      fc.property(counts, counts, (n, m) => {
        const bottles: Forme[] = FORMES.flatMap((f, i) => Array.from({ length: n[i]! }, () => f));
        const slotTypes: TypeClayette[] = TYPES_CLAYETTE.flatMap((t, i) => Array.from({ length: m[i]! }, () => t));
        // Couplage maximal par chemins augmentants (algorithme de Kuhn).
        const owner = new Array<number>(slotTypes.length).fill(-1);
        const augment = (b: number, seen: boolean[]): boolean => {
          for (let s = 0; s < slotTypes.length; s++) {
            if (seen[s] || !isCompatible(bottles[b]!, slotTypes[s]!)) continue;
            seen[s] = true;
            if (owner[s] === -1 || augment(owner[s]!, seen)) {
              owner[s] = b;
              return true;
            }
          }
          return false;
        };
        const matched = bottles.filter((_, b) => augment(b, new Array<boolean>(slotTypes.length).fill(false))).length;
        expect(isFeasible(n, m)).toBe(matched === bottles.length);
      }),
      { numRuns: 500, seed: 11 },
    );
  });
});

describe('sortedSequence', () => {
  const cellar = cellarFromRows([
    { type: 'tout', slots: [w('Pétrus', 2010), w('Yquem', null), w('Latour', 2000), w('Margaux', 2010)] },
    { type: 'tout', slots: [w('Angélus', 2010), null, w('Pétrus', 2010), w('Margaux', 2010)] },
  ]);
  const { model, arrangement } = buildModel(cellar);

  it('trie par année, sans millésime à la fin, groupes d\'un seul tenant', () => {
    // Positions moyennes en 2010 : Pétrus (0 + 6) / 2 = 3 ; Angélus 4 ; Margaux (3 + 7) / 2 = 5.
    expect(names(cellar, model, sortedSequence(model, arrangement, 'position'))).toEqual([
      'Latour 2000',
      'Pétrus 2010',
      'Pétrus 2010',
      'Angélus 2010',
      'Margaux 2010',
      'Margaux 2010',
      'Yquem',
    ]);
  });

  it('variante alpha : groupes d\'une même année par château', () => {
    expect(names(cellar, model, sortedSequence(model, arrangement, 'alpha'))).toEqual([
      'Latour 2000',
      'Angélus 2010',
      'Margaux 2010',
      'Margaux 2010',
      'Pétrus 2010',
      'Pétrus 2010',
      'Yquem',
    ]);
  });
});

describe('canonicalSequence — glouton respectant les types', () => {
  // Clayette 1 « bourgogne » (2 places), clayette 2 « tout » (3 places).
  const rows = (premier: 'bordeaux' | 'bourgogne') =>
    cellarFromRows([
      { type: 'bourgogne', slots: [null, premier === 'bourgogne' ? w('Pommard', 2015, 'bourgogne') : null] },
      {
        type: 'tout',
        slots: [
          w('Latour', 1990),
          w('Margaux', 1995),
          premier === 'bourgogne' ? null : w('Pommard', 2015, 'bourgogne'),
        ],
      },
    ]);

  it('économique : laisse vide la clayette dédiée tant que l\'ordre strict est possible', () => {
    const cellar = rows('bordeaux');
    const { model, arrangement } = buildModel(cellar);
    const { sigma, greedySlots } = canonicalSequence(model, sortedSequence(model, arrangement, 'position'), 'economique');
    expect(names(cellar, model, sigma)).toEqual(['Latour 1990', 'Margaux 1995', 'Pommard 2015']);
    expect(greedySlots).toEqual([2, 3, 4]);
  });

  it('compact : même ordre que le mode économique — le tri par année passe avant le remplissage', () => {
    const cellar = rows('bordeaux');
    const { model, arrangement } = buildModel(cellar);
    const { sigma, greedySlots } = canonicalSequence(model, sortedSequence(model, arrangement, 'position'), 'compact');
    expect(names(cellar, model, sigma)).toEqual(['Latour 1990', 'Margaux 1995', 'Pommard 2015']);
    expect(greedySlots).toEqual([2, 3, 4]);
  });

  it('à année égale, la place « tout » revient à la bouteille qui n\'a pas de clayette dédiée avant longtemps', () => {
    // tout×1, champagne×2, bordeaux×1 : le bordeaux 2005 doit prendre la place « tout »,
    // sinon il se retrouverait après le champagne 2010.
    const cellar = cellarFromRows([
      { type: 'tout', slots: [w('Bollinger', 2005, 'champagne')] },
      { type: 'champagne', slots: [w('Ruinart', 2010, 'champagne'), null] },
      { type: 'bordeaux', slots: [w('Margaux', 2005)] },
    ]);
    const { model, arrangement } = buildModel(cellar);
    const { sigma, greedySlots } = canonicalSequence(model, sortedSequence(model, arrangement, 'position'));
    expect(names(cellar, model, sigma)).toEqual(['Margaux 2005', 'Bollinger 2005', 'Ruinart 2010']);
    expect(greedySlots).toEqual([0, 1, 2]);
  });

  it('un lot entamé sur une clayette dédiée y continue plutôt que d\'être coupé', () => {
    // Deux bourgognes 2016 du même domaine, des bordeaux plus anciens : une fois le premier
    // bourgogne posé (forcé par le manque de places « tout »), le second le suit.
    const cellar = cellarFromRows([
      { type: 'bourgogne', slots: [null, null, null] },
      { type: 'tout', slots: [w('Latour', 2010), w('Pio', 2016, 'bourgogne'), w('Pio', 2016, 'bourgogne')] },
      { type: 'bordeaux', slots: [w('Margaux', 2012), w('Palmer', 2014)] },
    ]);
    const { model, arrangement } = buildModel(cellar);
    const { sigma, greedySlots } = canonicalSequence(model, sortedSequence(model, arrangement, 'position'));
    const order = names(cellar, model, sigma);
    const first = order.indexOf('Pio 2016');
    expect(order[first + 1]).toBe('Pio 2016');
    // Les deux bouteilles du lot sont sur la même clayette, côte à côte.
    expect(greedySlots[first + 1]! - greedySlots[first]!).toBe(1);
  });

  it('économique : une exception d\'ordre n\'est acceptée que si elle est inévitable', () => {
    // 4 bouteilles, 3 places « tout » : un bourgogne DOIT aller sur la clayette bourgogne.
    const cellar = cellarFromRows([
      { type: 'bourgogne', slots: [w('Volnay', 2012, 'bourgogne'), null] },
      { type: 'tout', slots: [w('Latour', 1990), w('Margaux', 1995), w('Pommard', 2015, 'bourgogne')] },
    ]);
    const { model, arrangement } = buildModel(cellar);
    const { sigma, greedySlots } = canonicalSequence(model, sortedSequence(model, arrangement, 'position'), 'economique');
    // Le 1er emplacement peut rester vide ; le 2e non (sinon 4 bouteilles pour 3 places).
    expect(names(cellar, model, sigma)).toEqual(['Volnay 2012', 'Latour 1990', 'Margaux 1995', 'Pommard 2015']);
    expect(greedySlots).toEqual([1, 2, 3, 4]);
  });

  it('économique : une bouteille du même groupe que la première restante peut la devancer', () => {
    // Même château, même année, deux formes : le bourgogne prend la place bourgogne.
    const cellar = cellarFromRows([
      { type: 'bourgogne', slots: [null] },
      { type: 'tout', slots: [w('Jadot', 2015, 'bordeaux'), w('Jadot', 2015, 'bourgogne'), w('Zind', 2020)] },
    ]);
    const { model, arrangement } = buildModel(cellar);
    const sorted = sortedSequence(model, arrangement, 'position');
    expect(sorted.map((c) => model.classes[c]!.forme)).toEqual(['bordeaux', 'bourgogne', 'bordeaux']);
    const { sigma } = canonicalSequence(model, sorted, 'economique');
    expect(sigma.map((c) => model.classes[c]!.forme)).toEqual(['bourgogne', 'bordeaux', 'bordeaux']);
  });

  it('propriétés : σ est une permutation des bouteilles, posée sur des emplacements compatibles croissants', () => {
    fc.assert(
      fc.property(arbCellar(), fc.constantFrom(...MODES), fc.constantFrom(...VARIANTS), (cellar, mode, variant) => {
        const { model, arrangement } = buildModel(cellar);
        const sorted = sortedSequence(model, arrangement, variant);
        const { sigma, greedySlots } = canonicalSequence(model, sorted, mode);
        expect([...sigma].sort((a, b) => a - b)).toEqual([...sorted].sort((a, b) => a - b));
        greedySlots.forEach((j, i) => {
          expect(classFits(model, sigma[i]!, j)).toBe(true);
          if (i > 0) expect(j).toBeGreaterThan(greedySlots[i - 1]!);
        });
        // Les années de `sorted` sont croissantes, sans millésime à la fin.
        const years = sorted.map((c) => model.classes[c]!.annee ?? Infinity);
        expect(years).toEqual([...years].sort((a, b) => a - b));
        // Sans contrainte de type, σ est exactement la suite triée.
        if (cellar.shelves.every((s) => s.type === 'tout')) expect(sigma).toEqual(sorted);
      }),
      { numRuns: 400, seed: 12 },
    );
  });
});

/** Énumère tous les placements strictement croissants de `n` bouteilles sur `m` emplacements. */
function* placements(n: number, m: number, from = 0, acc: number[] = []): Generator<number[]> {
  if (acc.length === n) {
    yield [...acc];
    return;
  }
  for (let j = from; j <= m - (n - acc.length); j++) {
    acc.push(j);
    yield* placements(n, m, j + 1, acc);
    acc.pop();
  }
}

describe('alignSequence — programmation dynamique', () => {
  it('est optimal et choisit, à score égal, le placement le plus haut/gauche (force brute)', () => {
    const small = arbCellar({ maxShelves: 4, maxCapacity: 4, maxSlots: 9, maxBottles: 6, maxWines: 4 });
    fc.assert(
      fc.property(small, fc.constantFrom(...MODES), fc.constantFrom(...VARIANTS), (cellar, mode, variant) => {
        const { model, arrangement } = buildModel(cellar);
        const { sigma } = canonicalSequence(model, sortedSequence(model, arrangement, variant), mode);
        const weights = integerWeights(mode, sigma.length, model.slots.length);
        const found = alignSequence(model, arrangement, sigma, weights);
        expect(found).not.toBeNull();
        // Référence : meilleur score, puis dernière bouteille la plus haute, puis l'avant-dernière…
        let best: number[] | null = null;
        let bestScore = -Infinity;
        for (const candidate of placements(sigma.length, model.slots.length)) {
          const score = placementScore(model, arrangement, sigma, candidate, weights);
          if (score === -Infinity) continue;
          let better = score > bestScore;
          if (!better && score === bestScore && best) {
            for (let i = sigma.length - 1; i >= 0; i--) {
              if (candidate[i] !== best[i]) {
                better = candidate[i]! < best[i]!;
                break;
              }
            }
          }
          if (better) {
            best = candidate;
            bestScore = score;
          }
        }
        expect(placementScore(model, arrangement, sigma, found!, weights)).toBe(bestScore);
        expect(Array.from(found!)).toEqual(best);
      }),
      { numRuns: 600, seed: 13 },
    );
  });

  it('renvoie null quand σ ne peut pas être placée', () => {
    const cellar = cellarFromRows([{ type: 'tout', slots: [w('A', 2000), w('B', 2001)] }]);
    const { model, arrangement } = buildModel(cellar);
    const weights = integerWeights('economique', 3, 2);
    expect(alignSequence(model, arrangement, [0, 1, 0], weights)).toBeNull();
    expect(Array.from(alignSequence(model, arrangement, [], weights)!)).toEqual([]);
  });

  it('compact : un vide au milieu n\'est jamais « payé » par des bouteilles laissées en place', () => {
    // Un vide en tête puis 9 bouteilles déjà triées : avec W_FIX = 0,2 pondéré, 9 bouteilles
    // en place (1,8) l'emporteraient sur le vide (1) ; le mode compact tasse quand même.
    const cellar = cellarFromRows([
      { type: 'tout', slots: [null, ...Array.from({ length: 9 }, (_, i) => w(`Château ${i}`, 2000 + i))] },
    ]);
    const { model, arrangement } = buildModel(cellar);
    const compact = planVariant(model, arrangement, 'compact', 'position');
    expect(Array.from(compact.target).indexOf(VIDE)).toBe(9);
    expect(compact.moves).toBe(9);
    const economique = planVariant(model, arrangement, 'economique', 'position');
    expect(economique.moves).toBe(0);
  });
});

describe('planTarget — stabilisation', () => {
  it('la cible est un point fixe : la replanifier ne déplace plus rien', () => {
    fc.assert(
      fc.property(arbCellar(), fc.constantFrom(...MODES), (cellar, mode) => {
        const { model, arrangement } = buildModel(cellar);
        const plan = planTarget(model, arrangement, mode);
        expect(plan.stable).toBe(true);
        expect(plan.iterations).toBeLessThanOrEqual(MAX_STABILISATION);
        expect(planOnce(model, plan.target, mode).moves).toBe(0);
        expect(planTarget(model, plan.target, mode).target).toEqual(plan.target);
      }),
      { numRuns: 400, seed: 14 },
    );
  });

  it('compact : la variante alpha se stabilise en une replanification', () => {
    fc.assert(
      fc.property(arbCellar(), (cellar) => {
        const { model, arrangement } = buildModel(cellar);
        const first = planVariant(model, arrangement, 'compact', 'alpha');
        expect(planVariant(model, first.target, 'compact', 'alpha').moves).toBe(0);
      }),
      { numRuns: 400, seed: 15 },
    );
  });
});
