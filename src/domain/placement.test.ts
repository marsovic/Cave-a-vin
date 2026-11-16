import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { addBottles, createCellar, freeSlots, isCompatible, slotKey } from './cellar';
import { suggestSlots } from './placement';
import { cellarWith, shelves, wine } from './testing';
import { FORMES, TYPES_CLAYETTE, type Cellar } from './types';

describe('proposition d\'emplacement', () => {
  it('propose la place voisine d\'une bouteille du même vin', () => {
    const cellar = cellarWith(shelves([6, 'tout'], [6, 'tout']), [
      [1, 1, { chateau: 'Autre', annee: 2000 }],
      [2, 3, { chateau: 'Château Test', annee: 2015 }],
    ]);
    const s = suggestSlots(cellar, wine(), 1);
    expect(s.complete).toBe(true);
    expect(s.slots[0]!.clayette).toBe(2);
    expect([2, 4]).toContain(s.slots[0]!.rang);
    expect(s.message).toMatch(/même vin/);
  });

  it('respecte l\'ordre des années : entre les plus anciennes et les plus récentes', () => {
    const cellar = cellarWith(shelves([4, 'tout'], [4, 'tout'], [4, 'tout']), [
      [1, 1, { chateau: 'A', annee: 2005 }],
      [1, 2, { chateau: 'B', annee: 2008 }],
      [3, 1, { chateau: 'C', annee: 2020 }],
    ]);
    const s = suggestSlots(cellar, wine({ chateau: 'Nouveau', annee: 2012 }), 1);
    // Après 2008 (clayette 1) et avant 2020 (clayette 3) : fin de clayette 1 ou clayette 2.
    const { clayette, rang } = s.slots[0]!;
    expect(clayette === 2 || (clayette === 1 && rang >= 3)).toBe(true);
  });

  it('préfère une clayette spécialisée à une clayette « tout », à situation égale', () => {
    const cellar = createCellar(shelves([4, 'tout'], [4, 'bordeaux']));
    expect(suggestSlots(cellar, wine({ forme: 'bordeaux' }), 1).slots[0]).toEqual({ clayette: 2, rang: 1 });
  });

  it('ne propose jamais une clayette incompatible', () => {
    const cellar = createCellar(shelves([4, 'bourgogne'], [4, 'champagne'], [2, 'tout']));
    const s = suggestSlots(cellar, wine({ forme: 'bordeaux' }), 3);
    expect(s.slots.every((slot) => slot.clayette === 3)).toBe(true);
    expect(s.complete).toBe(false);
    expect(s.message).toMatch(/Seulement 2 places/);
  });

  it('range plusieurs bouteilles côte à côte', () => {
    const cellar = cellarWith(shelves([6, 'tout'], [6, 'tout']), [
      [1, 2, { chateau: 'A', annee: 2010 }],
      [1, 4, { chateau: 'B', annee: 2011 }],
    ]);
    const s = suggestSlots(cellar, wine({ chateau: 'Lot', annee: 2012 }), 4);
    expect(s.complete).toBe(true);
    expect(new Set(s.slots.map((x) => x.clayette)).size).toBe(1);
    const rangs = s.slots.map((x) => x.rang).sort((a, b) => a - b);
    expect(rangs[3]! - rangs[0]!).toBe(3);
  });

  it('respecte l\'emplacement désigné par l\'utilisateur et continue vers la droite', () => {
    const cellar = cellarWith(shelves([6, 'tout']), [[1, 4, { chateau: 'A' }]]);
    expect(suggestSlots(cellar, wine(), 1, { clayette: 1, rang: 2 }).slots).toEqual([{ clayette: 1, rang: 2 }]);
    expect(suggestSlots(cellar, wine(), 3, { clayette: 1, rang: 2 }).slots).toEqual([
      { clayette: 1, rang: 2 },
      { clayette: 1, rang: 3 },
      { clayette: 1, rang: 5 },
    ]);
    const occupied = suggestSlots(cellar, wine(), 1, { clayette: 1, rang: 4 });
    expect(occupied.slots).toEqual([]);
    expect(occupied.message).toMatch(/déjà occupé/);
  });

  it('respecte la clayette imposée seule', () => {
    const cellar = createCellar(shelves([3, 'tout'], [3, 'tout'], [3, 'bourgogne']));
    expect(suggestSlots(cellar, wine(), 2, { clayette: 2 }).slots.every((s) => s.clayette === 2)).toBe(true);
    expect(suggestSlots(cellar, wine({ forme: 'bordeaux' }), 1, { clayette: 3 }).slots).toEqual([]);
  });

  it('explique pourquoi rien n\'est possible', () => {
    const full = cellarWith(shelves([1, 'tout']), [[1, 1]]);
    expect(suggestSlots(full, wine(), 1).message).toMatch(/pleine/);
    const noMatch = createCellar(shelves([3, 'champagne']));
    expect(suggestSlots(noMatch, wine({ forme: 'bourgogne' }), 1).message).toMatch(/forme Bourgogne/);
  });

  it('propriété : les emplacements proposés sont toujours libres, compatibles, distincts et utilisables', () => {
    const shelfArb = fc.record({ capacite: fc.integer({ min: 1, max: 6 }), type: fc.constantFrom(...TYPES_CLAYETTE) });
    const fillArb = fc.array(fc.record({ forme: fc.constantFrom(...FORMES), annee: fc.option(fc.integer({ min: 1990, max: 2024 }), { nil: null }), chateau: fc.constantFrom('A', 'B', 'C') }), { maxLength: 20 });
    fc.assert(
      fc.property(fc.array(shelfArb, { minLength: 1, maxLength: 5 }), fillArb, fc.constantFrom(...FORMES), fc.integer({ min: 1, max: 6 }), (config, fill, forme, count) => {
        let cellar: Cellar = createCellar(config);
        for (const f of fill) {
          const free = freeSlots(cellar, { forme: f.forme })[0];
          if (!free) continue;
          const res = addBottles(cellar, wine(f), [free]);
          if (res.ok) cellar = res.value.cellar;
        }
        const candidate = wine({ forme, chateau: 'A', annee: 2010 });
        const s = suggestSlots(cellar, candidate, count);
        const compatibleFree = freeSlots(cellar, { forme }).length;
        expect(s.slots.length).toBe(Math.min(count, compatibleFree));
        expect(s.complete).toBe(s.slots.length === count);
        expect(new Set(s.slots.map(slotKey)).size).toBe(s.slots.length);
        for (const slot of s.slots) expect(isCompatible(forme, cellar.shelves[slot.clayette - 1]!.type)).toBe(true);
        if (s.slots.length > 0) expect(addBottles(cellar, candidate, s.slots).ok).toBe(true);
      }),
      { numRuns: 200, seed: 42 },
    );
  });
});
