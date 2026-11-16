import { describe, expect, it } from 'vitest';
import { groupKey, identityKey, norm, parseForme, parseRobe, parseTypeClayette, splitCepages, wineKey } from './normalize';
import { wine } from './testing';

describe('normalisation', () => {
  it('retire accents, casse et ponctuation', () => {
    expect(norm('  Château  d\'Yquem ')).toBe('chateau d yquem');
    expect(norm('Saint-Émilion')).toBe('saint emilion');
    expect(norm('Cœur de Bœuf')).toBe('coeur de boeuf');
  });

  it('découpe les cépages sans doublon', () => {
    expect(splitCepages('Merlot, Cabernet franc ; merlot / Malbec et Tannat')).toEqual(['Merlot', 'Cabernet franc', 'Malbec', 'Tannat']);
    expect(splitCepages(' , ')).toEqual([]);
  });

  it('reconnaît les robes sans confondre rosé et rouge', () => {
    expect(parseRobe('Rouge')).toBe('rouge');
    expect(parseRobe('Rosé')).toBe('rose');
    expect(parseRobe('rose')).toBe('rose');
    expect(parseRobe('Blanc')).toBe('blanc');
    expect(parseRobe('Blanc liquoreux')).toBe('blanc-liquoreux');
    expect(parseRobe('moelleux')).toBe('blanc-liquoreux');
    expect(parseRobe('')).toBeNull();
    expect(parseRobe('orange')).toBeNull();
  });

  it('reconnaît formes et types de clayette', () => {
    expect(parseForme('Bordelaise')).toBe('bordeaux');
    expect(parseForme('bourgogne')).toBe('bourgogne');
    expect(parseForme('Champenoise')).toBe('champagne');
    expect(parseForme('Autre')).toBe('autre');
    expect(parseForme('?')).toBeNull();
    expect(parseTypeClayette('Tout')).toBe('tout');
    expect(parseTypeClayette('BORDEAUX')).toBe('bordeaux');
    expect(parseTypeClayette('')).toBeNull();
  });
});

describe('clés', () => {
  it('groupe = même château et même année, quelle que soit l\'écriture', () => {
    expect(groupKey(wine({ chateau: 'Château Margaux' }))).toBe(groupKey(wine({ chateau: 'CHATEAU  MARGAUX' })));
    expect(groupKey(wine({ annee: 2015 }))).not.toBe(groupKey(wine({ annee: 2016 })));
    expect(groupKey(wine({ annee: null }))).not.toBe(groupKey(wine({ annee: 2016 })));
  });

  it('vin = château, appellation, année, robe', () => {
    expect(wineKey(wine())).toBe(wineKey(wine({ cepages: [], forme: 'autre' })));
    expect(wineKey(wine({ robe: 'rouge' }))).not.toBe(wineKey(wine({ robe: 'rose' })));
  });

  it('identité = bouteilles physiquement interchangeables', () => {
    const a = { ...wine(), collection: false };
    expect(identityKey(a)).toBe(identityKey({ ...a, cepages: ['merlot', 'CABERNET SAUVIGNON'] }));
    expect(identityKey(a)).not.toBe(identityKey({ ...a, collection: true }));
    expect(identityKey(a)).not.toBe(identityKey({ ...a, forme: 'bourgogne' }));
  });
});
