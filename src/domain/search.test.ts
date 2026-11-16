import { describe, expect, it } from 'vitest';
import {
  compileCriteria,
  criteriaError,
  criteriaFromBottle,
  describeCriteria,
  hasAnyCriteria,
  hasWineCriteria,
  parseYearExpr,
  searchBottles,
  wineFromCriteria,
} from './search';
import { cellarWith, shelves } from './testing';
import { EMPTY_CRITERIA, type Criteria } from './types';

const crit = (partial: Partial<Criteria>): Criteria => ({ ...EMPTY_CRITERIA, ...partial });

function year(expr: string, annee: number | null): boolean {
  const filter = parseYearExpr(expr);
  if (!filter.ok) throw new Error(filter.error);
  return filter.test(annee);
}

describe('expression d\'année', () => {
  it('année exacte, sur 4 ou 2 chiffres', () => {
    expect(year('2015', 2015)).toBe(true);
    expect(year('2015', 2014)).toBe(false);
    expect(year('15', 2015)).toBe(true);
    expect(year('98', 1998)).toBe(true);
    expect(year('2015', null)).toBe(false);
  });

  it('périodes, dans les deux sens et avec différentes écritures', () => {
    for (const expr of ['2010-2015', '2010 - 2015', '2015-2010', '2010..2015', '2010 à 2015', '2010–2015']) {
      expect(year(expr, 2010), expr).toBe(true);
      expect(year(expr, 2015), expr).toBe(true);
      expect(year(expr, 2016), expr).toBe(false);
    }
  });

  it('comparaisons', () => {
    expect(year('<2012', 2011)).toBe(true);
    expect(year('<2012', 2012)).toBe(false);
    expect(year('<=2012', 2012)).toBe(true);
    expect(year('>=2018', 2018)).toBe(true);
    expect(year('> 2018', 2018)).toBe(false);
    expect(year('>2018', null)).toBe(false);
  });

  it('listes (« ou ») et bouteilles sans millésime', () => {
    expect(year('2010, 2012', 2012)).toBe(true);
    expect(year('2010 2012', 2011)).toBe(false);
    expect(year('sans', null)).toBe(true);
    expect(year('NM', 2015)).toBe(false);
    expect(year('<2010, sans', null)).toBe(true);
    expect(year('<2010, sans', 2005)).toBe(true);
    expect(year('<2010, sans', 2015)).toBe(false);
  });

  it('signale une saisie incompréhensible', () => {
    expect(parseYearExpr('deux mille').ok).toBe(false);
    expect(parseYearExpr('201').ok).toBe(false);
    expect(parseYearExpr('').ok).toBe(true);
    const single = parseYearExpr('2015');
    expect(single.ok && single.single).toBe(2015);
  });
});

describe('critères', () => {
  const cellar = cellarWith(shelves([4, 'tout'], [4, 'tout']), [
    [1, 1, { chateau: 'Château Margaux', appellation: 'Margaux', annee: 2015, cepages: ['Cabernet Sauvignon', 'Merlot'] }],
    [1, 2, { chateau: 'Château d\'Yquem', appellation: 'Sauternes', annee: 2009, cepages: ['Sémillon', 'Sauvignon blanc'], robe: 'blanc-liquoreux' }],
    [2, 1, { chateau: 'Domaine Tempier', appellation: 'Bandol', annee: 2015, cepages: ['Mourvèdre'], robe: 'rose' }],
    [2, 3, { chateau: 'Ruinart', appellation: 'Champagne', annee: null, cepages: ['Chardonnay'], robe: 'blanc', forme: 'champagne' }],
  ]);
  const names = (c: Partial<Criteria>): string[] => searchBottles(cellar, crit(c)).map((b) => b.chateau);

  it('compare sans tenir compte de la casse ni des accents, par inclusion', () => {
    expect(names({ chateau: 'yquem' })).toEqual(['Château d\'Yquem']);
    expect(names({ chateau: 'CHATEAU' })).toHaveLength(2);
    expect(names({ appellation: 'sauterne' })).toEqual(['Château d\'Yquem']);
  });

  it('exige tous les cépages saisis', () => {
    expect(names({ cepages: 'merlot' })).toEqual(['Château Margaux']);
    expect(names({ cepages: 'Sémillon, sauvignon' })).toEqual(['Château d\'Yquem']);
    expect(names({ cepages: 'merlot, syrah' })).toEqual([]);
  });

  it('ne garde que les bouteilles satisfaisant tous les critères', () => {
    expect(names({ annee: '2015' })).toEqual(['Château Margaux', 'Domaine Tempier']);
    expect(names({ annee: '2015', robe: 'rose' })).toEqual(['Domaine Tempier']);
    expect(names({ annee: '2015', robe: 'blanc' })).toEqual([]);
    expect(names({ annee: 'sans' })).toEqual(['Ruinart']);
    expect(names({ forme: 'champagne' })).toEqual(['Ruinart']);
  });

  it('restreint par clayette et par rang', () => {
    expect(names({ clayette: '2' })).toEqual(['Domaine Tempier', 'Ruinart']);
    expect(names({ clayette: '2', rang: '3' })).toEqual(['Ruinart']);
    expect(names({ rang: '1' })).toEqual(['Château Margaux', 'Domaine Tempier']);
  });

  it('des critères invalides ne correspondent à rien et sont signalés', () => {
    expect(names({ annee: 'abc' })).toEqual([]);
    expect(criteriaError(crit({ annee: 'abc' }), cellar)).toMatch(/Année/);
    expect(criteriaError(crit({ clayette: '9' }), cellar)).toMatch(/2 clayette/);
    expect(criteriaError(crit({ clayette: '1', rang: '7' }), cellar)).toMatch(/4 emplacement/);
    expect(criteriaError(crit({ clayette: '1', rang: '2' }), cellar)).toBeNull();
    expect(compileCriteria(crit({ clayette: 'x' }))(cellar.bottles[0]!)).toBe(false);
  });

  it('distingue critères « vin » et critères de position', () => {
    expect(hasWineCriteria(crit({ clayette: '1' }))).toBe(false);
    expect(hasAnyCriteria(crit({ clayette: '1' }))).toBe(true);
    expect(hasWineCriteria(crit({ robe: 'rouge' }))).toBe(true);
    expect(describeCriteria(crit({ appellation: 'Margaux', annee: '2010-2015', robe: 'rouge', clayette: '3' }))).toBe(
      'Margaux · 2010-2015 · Rouge · clayette 3',
    );
  });
});

describe('formulaire ↔ bouteille', () => {
  it('convertit le formulaire en vin à ajouter', () => {
    const res = wineFromCriteria(
      crit({ chateau: '  Château  Margaux ', appellation: 'Margaux', annee: '15', cepages: 'Merlot ; Cabernet franc', robe: 'rouge', forme: 'bordeaux' }),
    );
    expect(res).toEqual({
      ok: true,
      value: { chateau: 'Château Margaux', appellation: 'Margaux', annee: 2015, cepages: ['Merlot', 'Cabernet franc'], robe: 'rouge', forme: 'bordeaux' },
    });
  });

  it('accepte une bouteille sans millésime, refuse une période ou une description incomplète', () => {
    const base = { chateau: 'X', robe: 'blanc', forme: 'champagne' } as const;
    expect(wineFromCriteria(crit({ ...base, annee: '' })).ok).toBe(true);
    const nm = wineFromCriteria(crit({ ...base, annee: 'sans' }));
    expect(nm.ok && nm.value.annee).toBeNull();
    expect(wineFromCriteria(crit({ ...base, annee: '2010-2015' })).ok).toBe(false);
    expect(wineFromCriteria(crit({ ...base, annee: '1700' })).ok).toBe(false);
    expect(wineFromCriteria(crit({ robe: 'blanc', forme: 'champagne' })).ok).toBe(false);
    expect(wineFromCriteria(crit({ chateau: 'X', forme: 'champagne' })).ok).toBe(false);
    expect(wineFromCriteria(crit({ chateau: 'X', robe: 'blanc' })).ok).toBe(false);
  });

  it('remplit le formulaire depuis une bouteille (aller-retour)', () => {
    const cellar = cellarWith(shelves([3, 'tout']), [[1, 2, { annee: null, cepages: ['Syrah', 'Grenache'] }]]);
    const form = criteriaFromBottle(cellar.bottles[0]!);
    expect(form).toMatchObject({ annee: '', cepages: 'Syrah, Grenache', clayette: '1', rang: '2' });
    expect(searchBottles(cellar, form)).toHaveLength(1);
  });
});
