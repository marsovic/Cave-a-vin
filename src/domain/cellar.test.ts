import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  addBottles,
  bottleAt,
  cellarStats,
  createCellar,
  defaultCellar,
  freeSlots,
  isCompatible,
  moveBottle,
  removeBottles,
  setCollection,
  shelfChangeBlockers,
  swapBottles,
  updateBottle,
  updateShelves,
  validateCellar,
} from './cellar';
import { cellarWith, shelves, wine } from './testing';
import type { Cellar } from './types';

describe('compatibilité forme / clayette', () => {
  it('une clayette « tout » accepte toutes les formes, une clayette typée seulement la sienne', () => {
    expect(isCompatible('bordeaux', 'tout')).toBe(true);
    expect(isCompatible('autre', 'tout')).toBe(true);
    expect(isCompatible('bordeaux', 'bordeaux')).toBe(true);
    expect(isCompatible('bordeaux', 'bourgogne')).toBe(false);
    expect(isCompatible('autre', 'champagne')).toBe(false);
  });
});

describe('ajout', () => {
  it('ajoute plusieurs bouteilles identiques sans modifier la cave d\'origine', () => {
    const cellar = createCellar(shelves([4, 'tout']));
    const res = addBottles(cellar, wine(), [
      { clayette: 1, rang: 1 },
      { clayette: 1, rang: 2 },
    ]);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.cellar.bottles).toHaveLength(2);
    expect(new Set(res.value.added.map((b) => b.id)).size).toBe(2);
    expect(cellar.bottles).toHaveLength(0);
    expect(validateCellar(res.value.cellar)).toEqual([]);
  });

  it('refuse un emplacement occupé, inexistant, incompatible ou cité deux fois', () => {
    const cellar = cellarWith(shelves([3, 'bourgogne'], [3, 'tout']), [[2, 1]]);
    const add = (clayette: number, rang: number, forme: 'bordeaux' | 'bourgogne' = 'bordeaux') =>
      addBottles(cellar, wine({ forme }), [{ clayette, rang }]);
    expect(add(2, 1).ok).toBe(false);
    expect(add(3, 1).ok).toBe(false);
    expect(add(2, 9).ok).toBe(false);
    const incompatible = add(1, 1, 'bordeaux');
    expect(incompatible.ok).toBe(false);
    if (!incompatible.ok) expect(incompatible.error).toMatch(/Bordeaux.*clayette 1.*Bourgogne/);
    expect(add(1, 1, 'bourgogne').ok).toBe(true);
    const twice = addBottles(cellar, wine(), [
      { clayette: 2, rang: 2 },
      { clayette: 2, rang: 2 },
    ]);
    expect(twice.ok).toBe(false);
  });

  it('exige un château ou une appellation, et un millésime plausible', () => {
    const cellar = createCellar(shelves([3, 'tout']));
    expect(addBottles(cellar, wine({ chateau: ' ', appellation: '' }), [{ clayette: 1, rang: 1 }]).ok).toBe(false);
    expect(addBottles(cellar, wine({ annee: 1500 }), [{ clayette: 1, rang: 1 }]).ok).toBe(false);
    expect(addBottles(cellar, wine({ annee: null }), [{ clayette: 1, rang: 1 }]).ok).toBe(true);
  });
});

describe('déplacement et échange', () => {
  const cellar = cellarWith(shelves([3, 'bordeaux'], [3, 'bourgogne'], [3, 'tout']), [
    [1, 1, { chateau: 'A', forme: 'bordeaux' }],
    [2, 1, { chateau: 'B', forme: 'bourgogne' }],
    [3, 1, { chateau: 'C', forme: 'bordeaux' }],
  ]);
  const id = (c: number, r: number): string => bottleAt(cellar, { clayette: c, rang: r })!.id;

  it('déplace vers une place libre compatible', () => {
    const res = moveBottle(cellar, id(1, 1), { clayette: 3, rang: 2 });
    expect(res.ok).toBe(true);
    if (res.ok) expect(bottleAt(res.value, { clayette: 3, rang: 2 })?.chateau).toBe('A');
  });

  it('refuse une place occupée, incompatible, ou la place actuelle', () => {
    expect(moveBottle(cellar, id(1, 1), { clayette: 3, rang: 1 }).ok).toBe(false);
    expect(moveBottle(cellar, id(1, 1), { clayette: 2, rang: 2 }).ok).toBe(false);
    expect(moveBottle(cellar, id(1, 1), { clayette: 1, rang: 1 }).ok).toBe(false);
  });

  it('échange deux bouteilles seulement si chacune convient à la clayette de l\'autre', () => {
    const ok = swapBottles(cellar, id(1, 1), id(3, 1));
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(bottleAt(ok.value, { clayette: 1, rang: 1 })?.chateau).toBe('C');
      expect(bottleAt(ok.value, { clayette: 3, rang: 1 })?.chateau).toBe('A');
    }
    expect(swapBottles(cellar, id(1, 1), id(2, 1)).ok).toBe(false);
    expect(swapBottles(cellar, id(1, 1), id(1, 1)).ok).toBe(false);
  });
});

describe('collection, suppression, modification', () => {
  const cellar = cellarWith(shelves([4, 'bourgogne']), [
    [1, 1, { forme: 'bourgogne' }],
    [1, 2, { forme: 'bourgogne' }],
  ]);
  const [a, b] = cellar.bottles;

  it('classe et déclasse', () => {
    const classed = setCollection(cellar, [a!.id], true);
    expect(classed.bottles.map((x) => x.collection)).toEqual([true, false]);
    expect(setCollection(classed, [a!.id], false).bottles.every((x) => !x.collection)).toBe(true);
  });

  it('supprime par identifiant', () => {
    expect(removeBottles(cellar, [b!.id]).bottles.map((x) => x.id)).toEqual([a!.id]);
  });

  it('modifie la description sans déplacer, et refuse une forme incompatible avec la clayette', () => {
    const ok = updateBottle(cellar, a!.id, wine({ chateau: 'Corrigé', forme: 'bourgogne' }));
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      const updated = ok.value.bottles.find((x) => x.id === a!.id)!;
      expect(updated.chateau).toBe('Corrigé');
      expect([updated.clayette, updated.rang]).toEqual([1, 1]);
    }
    expect(updateBottle(cellar, a!.id, wine({ forme: 'bordeaux' })).ok).toBe(false);
  });
});

describe('configuration des clayettes', () => {
  const cellar = cellarWith(shelves([4, 'tout'], [4, 'tout']), [
    [1, 4, { forme: 'bordeaux' }],
    [2, 1, { forme: 'bourgogne' }],
  ]);

  it('accepte un agrandissement et un changement de type compatible', () => {
    const res = updateShelves(cellar, shelves([6, 'bordeaux'], [4, 'bourgogne'], [5, 'tout']));
    expect(res.ok).toBe(true);
    if (res.ok) expect(validateCellar(res.value)).toEqual([]);
  });

  it('refuse ce qui laisserait une bouteille sans place, en la nommant', () => {
    expect(shelfChangeBlockers(cellar, shelves([3, 'tout'], [4, 'tout']))).toHaveLength(1);
    expect(shelfChangeBlockers(cellar, shelves([4, 'tout']))).toHaveLength(1);
    expect(shelfChangeBlockers(cellar, shelves([4, 'champagne'], [4, 'tout']))).toHaveLength(1);
    const res = updateShelves(cellar, shelves([3, 'tout'], [4, 'tout']));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/Château Test 2015/);
  });

  it('borne le nombre de clayettes et d\'emplacements', () => {
    expect(updateShelves(cellar, []).ok).toBe(false);
    expect(updateShelves(cellar, shelves([0, 'tout'], [4, 'tout'])).ok).toBe(false);
    expect(updateShelves(cellar, shelves([99, 'tout'], [4, 'tout'])).ok).toBe(false);
  });
});

describe('lecture', () => {
  it('liste les places libres, filtrées par forme et par clayette', () => {
    const cellar = cellarWith(shelves([2, 'bordeaux'], [2, 'tout']), [[1, 1]]);
    expect(freeSlots(cellar)).toHaveLength(3);
    expect(freeSlots(cellar, { forme: 'bourgogne' })).toEqual([
      { clayette: 2, rang: 1 },
      { clayette: 2, rang: 2 },
    ]);
    expect(freeSlots(cellar, { clayette: 1 })).toEqual([{ clayette: 1, rang: 2 }]);
  });

  it('compte les bouteilles par robe et les places libres', () => {
    const cellar = cellarWith(shelves([5, 'tout']), [
      [1, 1, { robe: 'rouge' }],
      [1, 2, { robe: 'blanc' }, true],
    ]);
    expect(cellarStats(cellar)).toMatchObject({ capacite: 5, total: 2, libres: 3, collection: 1 });
    expect(cellarStats(cellar).parRobe).toMatchObject({ rouge: 1, blanc: 1, rose: 0 });
    expect(cellarStats(defaultCellar())).toMatchObject({ capacite: 144, total: 0 });
  });
});

describe('invariants (propriété)', () => {
  it('toute suite d\'opérations réussies laisse une cave valide', () => {
    const op = fc.record({
      kind: fc.constantFrom('add', 'move', 'swap', 'remove', 'collection'),
      clayette: fc.integer({ min: 1, max: 3 }),
      rang: fc.integer({ min: 1, max: 5 }),
      forme: fc.constantFrom('bordeaux', 'bourgogne', 'champagne', 'autre'),
      pick: fc.nat(),
      pick2: fc.nat(),
    });
    fc.assert(
      fc.property(fc.array(op, { maxLength: 40 }), (ops) => {
        let cellar: Cellar = createCellar(shelves([5, 'bordeaux'], [4, 'tout'], [5, 'bourgogne']));
        for (const o of ops) {
          const at = { clayette: o.clayette, rang: o.rang };
          const some = cellar.bottles[o.pick % Math.max(1, cellar.bottles.length)];
          const other = cellar.bottles[o.pick2 % Math.max(1, cellar.bottles.length)];
          if (o.kind === 'add') {
            const res = addBottles(cellar, wine({ forme: o.forme as never }), [at]);
            if (res.ok) cellar = res.value.cellar;
          } else if (o.kind === 'move' && some) {
            const res = moveBottle(cellar, some.id, at);
            if (res.ok) cellar = res.value;
          } else if (o.kind === 'swap' && some && other) {
            const res = swapBottles(cellar, some.id, other.id);
            if (res.ok) cellar = res.value;
          } else if (o.kind === 'remove' && some) {
            cellar = removeBottles(cellar, [some.id]);
          } else if (o.kind === 'collection' && some) {
            cellar = setCollection(cellar, [some.id], !some.collection);
          }
          expect(validateCellar(cellar)).toEqual([]);
        }
      }),
      { numRuns: 150, seed: 20261116 },
    );
  });
});
