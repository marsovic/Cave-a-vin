import { addBottles, createCellar } from './cellar';
import type { Cellar, Forme, Robe, Shelf, TypeClayette, WineFields } from './types';

/** Aides de test : construction concise de caves et de vins. */

export function wine(partial: Partial<WineFields> = {}): WineFields {
  return {
    chateau: 'Château Test',
    appellation: 'Margaux',
    annee: 2015,
    cepages: ['Cabernet Sauvignon', 'Merlot'],
    robe: 'rouge' as Robe,
    forme: 'bordeaux' as Forme,
    ...partial,
  };
}

export function shelves(...specs: [number, TypeClayette][]): Shelf[] {
  return specs.map(([capacite, type]) => ({ capacite, type }));
}

/** Cave avec des bouteilles posées : `[clayette, rang, vin partiel, collection?]`. */
export function cellarWith(
  config: Shelf[],
  bottles: [number, number, Partial<WineFields>?, boolean?][],
): Cellar {
  let cellar = createCellar(config);
  for (const [clayette, rang, partial, collection] of bottles) {
    const res = addBottles(cellar, wine(partial), [{ clayette, rang }], { collection: collection ?? false });
    if (!res.ok) throw new Error(res.error);
    cellar = res.value.cellar;
  }
  return cellar;
}
