import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Forme, Shelf } from '../types';
import { buildModel, buildSlots, VIDE } from './model';
import { countMoves, HORS_CAVE, planMoves, type RawMove } from './moves';
import { arbCellar, bruteForceMinMoves, shuffleArrangement, simulateMoves } from './testkit';

const _ = VIDE;
const A = 0;
const B = 1;
const C = 2;
const D = 3;

/** Planifie sur des clayettes données ; toutes les classes sont « bordeaux » sauf indication. */
function plan(
  shelves: Shelf[],
  current: number[],
  target: number[],
  formes: Forme[] = ['bordeaux', 'bordeaux', 'bordeaux', 'bordeaux'],
): RawMove[] {
  const { slots } = buildSlots(shelves);
  const moves = planMoves({ slots, formes, current, target });
  // Tout plan renvoyé doit être exécutable, mener à la cible et avoir la longueur annoncée.
  expect(simulateMoves(slots, formes, current, moves)).toEqual(target);
  expect(moves).toHaveLength(countMoves(current, target, formes.length));
  return moves;
}

const tout = (capacite: number): Shelf => ({ capacite, type: 'tout' });
const move = (from: number, to: number): RawMove => ({ from, to, temporaire: false });
const aside = (from: number, to: number): RawMove => ({ from, to, temporaire: true });

describe('planMoves — chaînes (un emplacement libre suffit)', () => {
  it('ne fait rien quand la cible est déjà atteinte', () => {
    expect(plan([tout(3)], [A, _, B], [A, _, B])).toEqual([]);
    expect(plan([tout(2)], [_, _], [_, _])).toEqual([]);
  });

  it('décale une file de bouteilles vers l\'emplacement libre, sans tampon', () => {
    // Le vide « remonte » : la bouteille de 1 va en 0, puis celle de 2 en 1.
    expect(plan([tout(3)], [_, A, B], [A, B, _])).toEqual([move(1, 0), move(2, 1)]);
  });

  it('traite les chaînes indépendantes de haut en bas', () => {
    expect(plan([tout(2), tout(2)], [_, A, B, _], [A, _, _, B])).toEqual([move(1, 0), move(2, 3)]);
  });

  it('découpe le circuit eulérien à chaque passage par un vide', () => {
    const moves = plan([tout(6)], [_, A, _, B, C, _], [A, _, B, C, _, _]);
    expect(moves).toEqual([move(1, 0), move(3, 2), move(4, 3)]);
    expect(moves.every((m) => !m.temporaire)).toBe(true);
  });
});

describe('planMoves — cycles (une bouteille mise de côté)', () => {
  it('échange deux bouteilles via l\'emplacement libre le plus proche', () => {
    // La bouteille en 1 est la plus proche du tampon 2 : c'est elle qu'on met de côté.
    expect(plan([tout(3)], [A, B, _], [B, A, _])).toEqual([aside(1, 2), move(0, 1), move(2, 0)]);
  });

  it('préfère un tampon sur la même clayette, sinon la clayette la plus proche', () => {
    // Libres : 3 (clayette 1) et 8 (clayette 3). Cycle sur la clayette 1 → tampon 3.
    const same = plan([tout(4), tout(4), tout(4)], [A, B, _, _, _, _, _, _, _, _, _, _], [B, A, _, _, _, _, _, _, _, _, _, _]);
    expect(same[0]).toEqual(aside(1, 2));
    // Cycle sur la clayette 3, libres sur les clayettes 1 et 2 → tampon sur la clayette 2.
    const near = plan([tout(2), tout(2), tout(2)], [_, C, _, D, A, B], [_, C, _, D, B, A]);
    expect(near[0]).toEqual(aside(4, 2));
    expect(near).toHaveLength(3);
  });

  it('cave pleine : la bouteille est posée hors de la cave le temps du cycle', () => {
    expect(plan([tout(2)], [A, B], [B, A])).toEqual([aside(0, HORS_CAVE), move(1, 0), move(HORS_CAVE, 1)]);
    // Cycle de longueur 3 : 4 déplacements.
    expect(plan([tout(3)], [C, A, B], [A, B, C])).toEqual([
      aside(0, HORS_CAVE),
      move(1, 0),
      move(2, 1),
      move(HORS_CAVE, 2),
    ]);
  });

  it('un emplacement libre incompatible ne peut pas servir de tampon', () => {
    const shelves: Shelf[] = [{ capacite: 2, type: 'bordeaux' }, { capacite: 1, type: 'bourgogne' }];
    const moves = plan(shelves, [A, B, _], [B, A, _]);
    expect(moves.map((m) => m.to)).toEqual([HORS_CAVE, 0, 1]);
  });

  it('choisit la rotation dont la bouteille est compatible avec le tampon', () => {
    // A est bordeaux, B bourgogne ; le seul emplacement libre est sur une clayette bourgogne.
    const shelves: Shelf[] = [tout(2), { capacite: 1, type: 'bourgogne' }];
    const moves = plan(shelves, [A, B, _], [B, A, _], ['bordeaux', 'bourgogne']);
    expect(moves).toEqual([aside(1, 2), move(0, 1), move(2, 0)]);
  });

  it('jamais plus d\'une bouteille hors cave : les cycles se suivent', () => {
    const moves = plan([tout(4)], [B, A, D, C], [A, B, C, D]);
    expect(moves).toEqual([
      aside(0, HORS_CAVE),
      move(1, 0),
      move(HORS_CAVE, 1),
      aside(2, HORS_CAVE),
      move(3, 2),
      move(HORS_CAVE, 3),
    ]);
  });

  it('passe un cycle avant les chaînes si son seul tampon possible va être occupé', () => {
    // Après la chaîne, le seul emplacement libre serait sur la clayette champagne
    // (incompatible avec A et B) : le cycle est fait d'abord, avec l'emplacement 2.
    const shelves: Shelf[] = [tout(3), { capacite: 1, type: 'champagne' }];
    const moves = plan(shelves, [A, B, _, C], [B, A, C, _], ['bordeaux', 'bordeaux', 'champagne']);
    expect(moves).toEqual([aside(1, 2), move(0, 1), move(2, 0), move(3, 2)]);
  });

  it('fait les chaînes avant les cycles dans le cas général', () => {
    const moves = plan([tout(5)], [B, A, _, C, _], [A, B, C, _, _]);
    expect(moves[0]).toEqual(move(3, 2));
    expect(moves).toHaveLength(4);
  });
});

describe('planMoves — bouteilles interchangeables', () => {
  it('une bouteille identique déjà bien placée ne bouge pas', () => {
    // Les emplacements 0 et 3 portent déjà la bonne classe.
    const moves = plan([tout(5)], [A, A, B, B, _], [A, B, A, B, _]);
    expect(moves).toHaveLength(3);
    for (const m of moves) {
      expect([m.from, m.to]).not.toContain(0);
      expect([m.from, m.to]).not.toContain(3);
    }
  });

  it('n\'importe quelle bouteille identique convient pour remplir un emplacement', () => {
    // Cible : A en 0. Les deux A (1 et 3) conviennent ; un seul déplacement suffit.
    expect(plan([tout(4)], [_, A, B, A], [A, _, B, A])).toEqual([move(1, 0)]);
    expect(plan([tout(4)], [_, A, B, A], [A, A, B, _])).toEqual([move(3, 0)]);
  });

  it('fusionne deux échanges en un seul cycle grâce aux bouteilles identiques', () => {
    // Appariement naïf : (0 ↔ 1) et (2 ↔ 3) = 2 cycles, 6 déplacements.
    // Comme A apparaît dans les deux, un seul circuit suffit : 4 + 1 = 5 déplacements.
    const moves = plan([tout(4)], [A, B, A, C], [B, A, C, A]);
    expect(moves).toHaveLength(5);
    expect(moves.filter((m) => m.to === HORS_CAVE)).toHaveLength(1);
  });

  it('rattache un échange à une chaîne quand une classe commune le permet', () => {
    // 0 ↔ 1 seul demanderait 3 déplacements + 1 pour la chaîne. Le circuit passant
    // par le vide n'a besoin d'aucun tampon : 3 déplacements en tout.
    const moves = plan([tout(4)], [A, B, A, _], [B, A, _, A]);
    expect(moves).toHaveLength(3);
    expect(moves.every((m) => !m.temporaire)).toBe(true);
  });
});

describe('planMoves — garde-fous', () => {
  it('refuse une cible qui ne contient pas les mêmes bouteilles', () => {
    const { slots } = buildSlots([tout(2)]);
    expect(() => planMoves({ slots, formes: ['bordeaux', 'bordeaux'], current: [A, _], target: [B, _] })).toThrow(
      /mêmes bouteilles/,
    );
  });
});

/** Cave aléatoire + cible obtenue par un mélange valide. */
const arbCase = (small: boolean) =>
  fc
    .tuple(
      small ? arbCellar({ maxShelves: 3, maxCapacity: 4, maxSlots: 6, maxBottles: 5, maxWines: 3 }) : arbCellar(),
      fc.array(fc.tuple(fc.nat(999), fc.nat(999)), { maxLength: small ? 8 : 60 }),
    )
    .map(([cellar, pairs]) => {
      const { model, arrangement } = buildModel(cellar);
      const formes = model.classes.map((c) => c.forme);
      const current = Array.from(arrangement);
      return { slots: model.slots, formes, current, target: shuffleArrangement(model.slots, formes, current, pairs) };
    });

describe('planMoves — propriétés', () => {
  it('la suite est exécutable, atteint la cible et a la longueur minimale annoncée', () => {
    fc.assert(
      fc.property(arbCase(false), ({ slots, formes, current, target }) => {
        const moves = planMoves({ slots, formes, current, target });
        expect(simulateMoves(slots, formes, current, moves)).toEqual(target);
        const misplaced = current.filter((c, s) => c !== VIDE && c !== target[s]).length;
        const temporaires = moves.filter((m) => m.temporaire).length;
        expect(moves).toHaveLength(countMoves(current, target, formes.length));
        expect(moves).toHaveLength(misplaced + temporaires);
        // Les emplacements déjà corrects ne sont jamais touchés.
        for (const m of moves) {
          for (const s of [m.from, m.to]) {
            if (s !== HORS_CAVE && current[s] !== VIDE) expect(current[s]).not.toBe(target[s]);
          }
        }
      }),
      { numRuns: 500, seed: 20240501 },
    );
  });

  it('OPTIMALITÉ : aucun parcours exhaustif ne fait mieux (petites caves)', () => {
    fc.assert(
      fc.property(arbCase(true), ({ slots, formes, current, target }) => {
        const moves = planMoves({ slots, formes, current, target });
        expect(moves.length).toBe(bruteForceMinMoves(slots, formes, current, target));
      }),
      { numRuns: 600, seed: 20240502 },
    );
  });
});
