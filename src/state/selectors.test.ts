import { describe, expect, it } from 'vitest';
import { cellarWith, shelves } from '../domain/testing';
import { EMPTY_CRITERIA } from '../domain/types';
import { freeSlotsForForm } from './selectors';

describe('freeSlotsForForm', () => {
  const cellar = cellarWith(shelves([4, 'bordeaux'], [4, 'bourgogne'], [3, 'tout']), [
    [1, 1],
    [2, 2, { forme: 'bourgogne' }],
  ]);
  const libres = (form: Partial<typeof EMPTY_CRITERIA>): string[] =>
    freeSlotsForForm(cellar, { ...EMPTY_CRITERIA, ...form }).map((s) => `${s.clayette}:${s.rang}`);

  it('sans critère : toutes les places libres', () => {
    expect(libres({})).toHaveLength(9);
  });

  it('clayette seule ou rang seul : filtre', () => {
    expect(libres({ clayette: '1' })).toEqual(['1:2', '1:3', '1:4']);
    expect(libres({ rang: '2' })).toEqual(['1:2', '3:2']);
  });

  it('clayette + rang désignent un emplacement : ce n’est plus un filtre', () => {
    expect(libres({ clayette: '1', rang: '1' })).toHaveLength(9);
    expect(libres({ clayette: '2', rang: '3' })).toHaveLength(9);
  });

  it('la forme limite aux clayettes compatibles', () => {
    expect(libres({ forme: 'bourgogne' })).toEqual(['2:1', '2:3', '2:4', '3:1', '3:2', '3:3']);
  });
});
