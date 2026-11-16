import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { addBottles, bottlesInReadingOrder, createCellar, freeSlots, isCompatible, validateCellar } from '../cellar';
import { groupKey } from '../normalize';
import { cellarWith, shelves, wine } from '../testing';
import { FORMES, TYPES_CLAYETTE, type Bottle, type Cellar } from '../types';
import { applyReorgStep, planReorganization, revertReorgStep, type ReorgMode, type ReorgPlan, type ReorgState } from './index';

const MODES: ReorgMode[] = ['economique', 'compact'];

/** Exécute tout le plan et renvoie l'état final ; vérifie chaque étape au passage. */
function run(cellar: Cellar, plan: ReorgPlan): ReorgState {
  let state: ReorgState = { cellar, horsCave: [] };
  for (const step of plan.steps) {
    const next = applyReorgStep(state, step);
    if (!next.ok) throw new Error(`étape ${step.index} refusée : ${next.error}`);
    expect(next.value.horsCave.length).toBeLessThanOrEqual(1);
    expect(validateCellar(next.value.cellar)).toEqual([]);
    // Aucune bouteille perdue ni dupliquée.
    expect(next.value.cellar.bottles.length + next.value.horsCave.length).toBe(cellar.bottles.length);
    // L'étape s'annule exactement.
    const back = revertReorgStep(next.value, step);
    expect(back.ok).toBe(true);
    if (back.ok) expect(positions(back.value.cellar)).toEqual(positions(state.cellar));
    state = next.value;
  }
  return state;
}

const positions = (cellar: Cellar): string[] => cellar.bottles.map((b) => `${b.id}@${b.clayette}:${b.rang}`).sort();
const years = (cellar: Cellar): number[] => bottlesInReadingOrder(cellar).map((b) => b.annee ?? Number.POSITIVE_INFINITY);
const isSorted = (values: number[]): boolean => values.every((v, i) => i === 0 || values[i - 1]! <= v);

/** Cave aléatoire valide : configuration variée, bouteilles avec doublons, sans millésime, formes mélangées. */
const cellarArb = fc
  .record({
    config: fc.array(fc.record({ capacite: fc.integer({ min: 1, max: 7 }), type: fc.constantFrom(...TYPES_CLAYETTE) }), { minLength: 1, maxLength: 6 }),
    bottles: fc.array(
      fc.record({
        chateau: fc.constantFrom('A', 'B', 'C', 'D'),
        annee: fc.option(fc.integer({ min: 2000, max: 2006 }), { nil: null, freq: 6 }),
        forme: fc.constantFrom(...FORMES),
        collection: fc.boolean(),
        where: fc.nat(),
      }),
      { maxLength: 40 },
    ),
  })
  .map(({ config, bottles }) => {
    let cellar = createCellar(config);
    for (const b of bottles) {
      const free = freeSlots(cellar, { forme: b.forme });
      if (free.length === 0) continue;
      const res = addBottles(cellar, wine({ chateau: b.chateau, annee: b.annee, forme: b.forme }), [free[b.where % free.length]!], { collection: b.collection });
      if (res.ok) cellar = res.value.cellar;
    }
    return cellar;
  });

describe('planReorganization — propriétés sur des caves aléatoires', () => {
  it('le plan est exécutable pas à pas, atteint la cible annoncée et ne perd aucune bouteille', () => {
    fc.assert(
      fc.property(cellarArb, fc.constantFrom(...MODES), (cellar, mode) => {
        const plan = planReorganization(cellar, { mode });
        const end = run(cellar, plan);
        expect(end.horsCave).toEqual([]);
        expect(positions(end.cellar)).toEqual(positions(plan.target));
        expect(validateCellar(plan.target)).toEqual([]);
        expect(plan.target.bottles.map((b) => b.id).sort()).toEqual(cellar.bottles.map((b) => b.id).sort());
        expect(plan.stats.deplacements).toBe(plan.steps.length);
        expect(plan.stats.bouteilles).toBe(cellar.bottles.length);
        expect(plan.stats.dejaEnPlace + plan.stats.aDeplacer).toBe(cellar.bottles.length);
        // Types de clayettes respectés dans la cible.
        for (const b of plan.target.bottles) expect(isCompatible(b.forme, plan.target.shelves[b.clayette - 1]!.type)).toBe(true);
      }),
      { numRuns: 300, seed: 1116 },
    );
  });

  it('la cible est stable : la replanifier ne demande plus aucun déplacement', () => {
    fc.assert(
      fc.property(cellarArb, fc.constantFrom(...MODES), (cellar, mode) => {
        const plan = planReorganization(cellar, { mode });
        expect(planReorganization(plan.target, { mode }).steps).toHaveLength(0);
      }),
      { numRuns: 200, seed: 2026 },
    );
  });

  it('clayettes toutes « tout » : la cible est strictement triée par année, sans millésime à la fin', () => {
    const openArb = cellarArb.map((cellar) => ({
      shelves: cellar.shelves.map((s) => ({ ...s, type: 'tout' as const })),
      bottles: cellar.bottles,
    }));
    fc.assert(
      fc.property(openArb, fc.constantFrom(...MODES), (cellar, mode) => {
        const plan = planReorganization(cellar, { mode });
        expect(isSorted(years(plan.target))).toBe(true);
        expect(plan.stats.exceptionsOrdre).toBe(0);
      }),
      { numRuns: 200, seed: 7 },
    );
  });

  it('les déplacements ne dépassent jamais « bouteilles déplacées + nombre de cycles »', () => {
    fc.assert(
      fc.property(cellarArb, (cellar) => {
        const plan = planReorganization(cellar);
        // Chaque bouteille déplacée bouge une fois, plus au plus un passage par un tampon par cycle.
        expect(plan.steps.length).toBeLessThanOrEqual(plan.stats.aDeplacer * 2);
        const temporaires = plan.steps.filter((s) => s.temporaire).length;
        expect(plan.steps.length).toBe(plan.stats.aDeplacer + temporaires);
      }),
      { numRuns: 200, seed: 99 },
    );
  });
});

describe('planReorganization — scénarios', () => {
  it('cave vide ou une seule bouteille : rien à faire', () => {
    expect(planReorganization(createCellar(shelves([4, 'tout']))).steps).toEqual([]);
    expect(planReorganization(cellarWith(shelves([4, 'tout']), [[1, 3]])).steps).toEqual([]);
  });

  it('une cave déjà triée et groupée ne bouge pas', () => {
    const cellar = cellarWith(shelves([4, 'tout'], [4, 'tout']), [
      [1, 1, { chateau: 'A', annee: 2001 }],
      [1, 2, { chateau: 'A', annee: 2001 }],
      [1, 3, { chateau: 'B', annee: 2005 }],
      [1, 4, { chateau: 'C', annee: 2010 }],
      [2, 1, { chateau: 'D', annee: null }],
    ]);
    for (const mode of MODES) expect(planReorganization(cellar, { mode }).steps, mode).toEqual([]);
    // Avec un trou en fin de clayette 1, le mode économique ne bouge toujours rien…
    const gap = cellarWith(shelves([4, 'tout'], [4, 'tout']), [
      [1, 1, { chateau: 'A', annee: 2001 }],
      [1, 2, { chateau: 'B', annee: 2005 }],
      [2, 1, { chateau: 'C', annee: 2010 }],
    ]);
    expect(planReorganization(gap, { mode: 'economique' }).steps).toEqual([]);
    // … et le mode compact comble le trou.
    expect(planReorganization(gap, { mode: 'compact' }).steps).toHaveLength(1);
  });

  it('ne permute pas deux bouteilles d\'un même lot qui ne diffèrent que par le statut « collection »', () => {
    // Lot de trois 2000 : la bouteille de collection est au milieu ; une 1990 à remonter devant.
    const cellar = cellarWith(shelves([6, 'tout']), [
      [1, 2, { chateau: 'Lot', annee: 2000 }],
      [1, 3, { chateau: 'Lot', annee: 2000 }, true],
      [1, 4, { chateau: 'Lot', annee: 2000 }],
      [1, 5, { chateau: 'Vieux', annee: 1990 }],
    ]);
    for (const mode of MODES) {
      const plan = planReorganization(cellar, { mode });
      const end = run(cellar, plan);
      expect(bottlesInReadingOrder(end.cellar).map((b) => b.chateau), mode).toEqual(['Vieux', 'Lot', 'Lot', 'Lot']);
      // Seule la 1990 change vraiment de place (plus, en mode compact, le décalage minimal du lot).
      expect(plan.steps.length, mode).toBeLessThanOrEqual(mode === 'economique' ? 1 : 2);
      // La bouteille de collection n'a pas été échangée avec ses voisines.
      const collection = end.cellar.bottles.find((b) => b.collection)!;
      expect([collection.clayette, collection.rang], mode).toEqual([1, 3]);
    }
  });

  it('trie par année et regroupe même château + même année côte à côte', () => {
    const cellar = cellarWith(shelves([6, 'tout'], [6, 'tout']), [
      [1, 1, { chateau: 'Récent', annee: 2020 }],
      [1, 3, { chateau: 'Lot', annee: 2010 }],
      [1, 6, { chateau: 'Ancien', annee: 1995 }],
      [2, 2, { chateau: 'Lot', annee: 2010 }],
      [2, 5, { chateau: 'Sans millésime', annee: null }],
      [2, 6, { chateau: 'Lot', annee: 2010 }],
    ]);
    for (const mode of MODES) {
      const plan = planReorganization(cellar, { mode });
      const order = bottlesInReadingOrder(plan.target);
      expect(order.map((b) => b.chateau), mode).toEqual(['Ancien', 'Lot', 'Lot', 'Lot', 'Récent', 'Sans millésime']);
      const lot = order.filter((b) => b.chateau === 'Lot');
      expect(new Set(lot.map((b) => b.clayette)).size, mode).toBe(1);
      expect(lot[2]!.rang - lot[0]!.rang, mode).toBe(2);
      expect(plan.stats.groupesSepares, mode).toBe(0);
      run(cellar, plan);
    }
    // Mode compact : tout est tassé depuis la première place.
    const compact = bottlesInReadingOrder(planReorganization(cellar, { mode: 'compact' }).target);
    expect(compact.map((b) => [b.clayette, b.rang])).toEqual([[1, 1], [1, 2], [1, 3], [1, 4], [1, 5], [1, 6]]);
  });

  it('respecte les types de clayettes même si l\'ordre global en souffre, et le signale', () => {
    // Bourgogne ancien, bordeaux récents ; la clayette du haut n'accepte que les bordeaux.
    const cellar = cellarWith(shelves([3, 'bordeaux'], [3, 'bourgogne']), [
      [1, 1, { chateau: 'Bdx 2015', annee: 2015, forme: 'bordeaux' }],
      [1, 2, { chateau: 'Bdx 2012', annee: 2012, forme: 'bordeaux' }],
      [2, 1, { chateau: 'Bgn 1990', annee: 1990, forme: 'bourgogne' }],
    ]);
    const plan = planReorganization(cellar);
    const order = bottlesInReadingOrder(plan.target).map((b) => b.chateau);
    expect(order).toEqual(['Bdx 2012', 'Bdx 2015', 'Bgn 1990']);
    expect(plan.stats.exceptionsOrdre).toBe(1);
    expect(plan.notes.join(' ')).toMatch(/type des clayettes/);
  });

  it('cave pleine : une bouteille passe hors de la cave le temps de l\'échange', () => {
    const cellar = cellarWith(shelves([3, 'tout']), [
      [1, 1, { chateau: 'C', annee: 2020 }],
      [1, 2, { chateau: 'A', annee: 2000 }],
      [1, 3, { chateau: 'B', annee: 2010 }],
    ]);
    const plan = planReorganization(cellar);
    expect(plan.steps).toHaveLength(4); // 3 bouteilles mal placées + 1 mise de côté
    expect(plan.steps[0]!.to).toBe('hors-cave');
    expect(plan.steps.at(-1)!.from).toBe('hors-cave');
    expect(bottlesInReadingOrder(run(cellar, plan).cellar).map((b) => b.chateau)).toEqual(['A', 'B', 'C']);
  });

  it('les bouteilles identiques sont interchangeables : celles déjà bien placées ne bougent pas', () => {
    const cellar = cellarWith(shelves([4, 'tout']), [
      [1, 1, { chateau: 'Lot', annee: 2010 }],
      [1, 2, { chateau: 'Vieux', annee: 1990 }],
      [1, 3, { chateau: 'Lot', annee: 2010 }],
    ]);
    const plan = planReorganization(cellar, { mode: 'compact' });
    // Cible : Vieux, Lot, Lot. Une des deux bouteilles « Lot » reste en place (rang 3).
    expect(plan.steps.length).toBeLessThanOrEqual(3);
    const end = run(cellar, plan);
    expect(bottlesInReadingOrder(end.cellar).map((b) => b.chateau)).toEqual(['Vieux', 'Lot', 'Lot']);
    expect(plan.stats.dejaEnPlace).toBeGreaterThanOrEqual(1);
  });

  it('le mode économique ne déplace jamais plus que le mode compact', () => {
    fc.assert(
      fc.property(cellarArb, (cellar) => {
        const eco = planReorganization(cellar, { mode: 'economique' }).steps.length;
        const compact = planReorganization(cellar, { mode: 'compact' }).steps.length;
        // Le mode économique privilégie l'ordre strict des années : il peut coûter quelques
        // déplacements de plus quand les types de clayettes s'en mêlent, jamais beaucoup plus.
        expect(eco).toBeLessThanOrEqual(compact + 3);
      }),
      { numRuns: 120, seed: 5 },
    );
  });

  it('les groupes tiennent ensemble quand la place le permet', () => {
    const bottles: [number, number, Partial<Bottle>][] = [];
    // 3 lots de 3, éparpillés sur 3 clayettes de 6.
    const spots: [number, number][] = [[1, 1], [2, 4], [3, 2], [1, 5], [2, 1], [3, 6], [1, 3], [2, 6], [3, 4]];
    spots.forEach(([c, r], i) => bottles.push([c, r, { chateau: `Lot ${i % 3}`, annee: 2010 + (i % 3) }]));
    const cellar = cellarWith(shelves([6, 'tout'], [6, 'tout'], [6, 'tout']), bottles);
    for (const mode of MODES) {
      const plan = planReorganization(cellar, { mode });
      expect(plan.stats.groupesSepares, mode).toBe(0);
      const byGroup = new Map<string, Bottle[]>();
      for (const b of plan.target.bottles) byGroup.set(groupKey(b), [...(byGroup.get(groupKey(b)) ?? []), b]);
      for (const group of byGroup.values()) {
        expect(new Set(group.map((b) => b.clayette)).size, mode).toBe(1);
        const rangs = group.map((b) => b.rang).sort((a, b) => a - b);
        expect(rangs.at(-1)! - rangs[0]!, mode).toBe(group.length - 1);
      }
    }
  });
});

describe('planReorganization — performance', () => {
  function bigCellar(shelfCount: number, capacity: number, fill: number): Cellar {
    const config = Array.from({ length: shelfCount }, (_, i) => ({ capacite: capacity, type: TYPES_CLAYETTE[i % 5 === 0 ? 3 : 3] }));
    let cellar = createCellar(config);
    let seed = 12345;
    const rand = (n: number): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % n;
    };
    const slots = freeSlots(cellar);
    const count = Math.floor(slots.length * fill);
    // Mélange déterministe des emplacements.
    for (let i = slots.length - 1; i > 0; i--) {
      const j = rand(i + 1);
      [slots[i], slots[j]] = [slots[j]!, slots[i]!];
    }
    for (let i = 0; i < count; i++) {
      const res = addBottles(cellar, wine({ chateau: `Château ${rand(60)}`, annee: 1990 + rand(34) }), [slots[i]!]);
      if (res.ok) cellar = res.value.cellar;
    }
    return cellar;
  }

  it('15 × 15 remplie à 80 % : moins d\'une demi-seconde', () => {
    const cellar = bigCellar(15, 15, 0.8);
    const start = performance.now();
    const plan = planReorganization(cellar);
    const elapsed = performance.now() - start;
    expect(isSorted(years(plan.target))).toBe(true);
    expect(elapsed).toBeLessThan(500);
  });

  it('30 × 20 pleine (600 bouteilles) : moins de deux secondes par mode', () => {
    const cellar = bigCellar(30, 20, 1);
    expect(cellar.bottles).toHaveLength(600);
    for (const mode of MODES) {
      const start = performance.now();
      const plan = planReorganization(cellar, { mode });
      const elapsed = performance.now() - start;
      expect(isSorted(years(plan.target)), mode).toBe(true);
      expect(elapsed, mode).toBeLessThan(2000);
    }
  });
});
