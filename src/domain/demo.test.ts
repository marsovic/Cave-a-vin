import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { bottlesInReadingOrder, cellarStats, validateCellar } from './cellar';
import { looksLikeCellarCsv, parseCellarCsv, serializeCellar } from './csv';
import { DEMO_CSV, demoCellar } from './demo';
import { groupKey, identityKey, wineKey } from './normalize';
import { FORMES, ROBES, type Bottle } from './types';

const PUBLIC_FILE = resolve(dirname(fileURLToPath(import.meta.url)), '../../public/exemple-cave.csv');

const cellar = demoCellar();
const bottles = bottlesInReadingOrder(cellar);

/** Lots de bouteilles du même groupe (même château + même année). */
function lots(): Bottle[][] {
  const map = new Map<string, Bottle[]>();
  for (const b of bottles) {
    const key = groupKey(b);
    const lot = map.get(key);
    if (lot) lot.push(b);
    else map.set(key, [b]);
  }
  return [...map.values()];
}

/** Le lot est-il d'un seul tenant sur une même clayette ? */
function contiguous(lot: Bottle[]): boolean {
  const first = lot[0];
  if (!first) return true;
  const rangs = lot.map((b) => b.rang).sort((a, b) => a - b);
  return lot.every((b) => b.clayette === first.clayette) && rangs.every((r, i) => r === (rangs[0] ?? 0) + i);
}

function withAppellation(...appellations: string[]): Bottle[] {
  return bottles.filter((b) => appellations.includes(b.appellation));
}

describe('DEMO_CSV', () => {
  it('se lit sans erreur ni avertissement et respecte les invariants de la cave', () => {
    const result = parseCellarCsv(DEMO_CSV);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.stats).toEqual({ bouteilles: 94, clayettes: 12, lignesIgnorees: 0 });
    if (!result.cellar) throw new Error('cave attendue');
    expect(validateCellar(result.cellar)).toEqual([]);
  });

  it('est au format canonique du contrat (CRLF, sans BOM, ordre de lecture)', () => {
    expect(DEMO_CSV.charCodeAt(0)).not.toBe(0xfeff);
    expect(DEMO_CSV.endsWith('\r\n')).toBe(true);
    expect(DEMO_CSV.replaceAll('\r\n', '')).not.toMatch(/[\r\n]/);
    expect(looksLikeCellarCsv(DEMO_CSV)).toBe(true);
    expect(serializeCellar(cellar)).toBe(DEMO_CSV);
  });

  it('décrit 12 clayettes de 10 à 14 emplacements, de types mélangés', () => {
    expect(cellar.shelves).toHaveLength(12);
    for (const shelf of cellar.shelves) {
      expect(shelf.capacite).toBeGreaterThanOrEqual(10);
      expect(shelf.capacite).toBeLessThanOrEqual(14);
    }
    const count = (type: string): number => cellar.shelves.filter((s) => s.type === type).length;
    expect(count('champagne')).toBe(1);
    expect(count('bourgogne')).toBe(2);
    expect(count('bordeaux')).toBeGreaterThanOrEqual(3);
    expect(count('tout')).toBeGreaterThanOrEqual(3);
    expect(new Set(cellar.shelves.map((s) => s.capacite)).size).toBeGreaterThan(1);
  });

  it('contient 85 à 100 bouteilles, dont 6 à 10 de collection, et garde de la place libre', () => {
    const stats = cellarStats(cellar);
    expect(stats.total).toBeGreaterThanOrEqual(85);
    expect(stats.total).toBeLessThanOrEqual(100);
    expect(stats.collection).toBeGreaterThanOrEqual(6);
    expect(stats.collection).toBeLessThanOrEqual(10);
    expect(stats.libres).toBeGreaterThanOrEqual(20);
    for (const robe of ROBES) expect(stats.parRobe[robe]).toBeGreaterThan(0);
    expect(stats.parRobe.rouge).toBeGreaterThan(stats.parRobe.blanc);
    for (const forme of FORMES) expect(bottles.some((b) => b.forme === forme)).toBe(true);
  });

  it('décrit complètement chaque bouteille', () => {
    for (const b of bottles) {
      expect(b.chateau).not.toBe('');
      expect(b.appellation).not.toBe('');
      expect(b.cepages.length).toBeGreaterThan(0);
    }
  });

  it('mêle des millésimes de 1985 à 2024, quelques bouteilles anciennes et quelques non millésimées', () => {
    const annees = bottles.flatMap((b) => (b.annee === null ? [] : [b.annee]));
    expect(Math.min(...annees)).toBeGreaterThanOrEqual(1985);
    expect(Math.max(...annees)).toBeLessThanOrEqual(2024);
    expect(Math.max(...annees)).toBeGreaterThanOrEqual(2022);
    // Anciennes : au moins quelques bouteilles de plus de 25 ans, dont certaines hors collection
    // (vins modestes probablement passés).
    const anciennes = bottles.filter((b) => b.annee !== null && b.annee <= 2000);
    expect(anciennes.length).toBeGreaterThanOrEqual(4);
    expect(anciennes.some((b) => !b.collection)).toBe(true);
    const sansMillesime = bottles.filter((b) => b.annee === null);
    expect(sansMillesime.length).toBeGreaterThanOrEqual(3);
    expect(sansMillesime.length).toBeLessThanOrEqual(12);
    expect(new Set(annees).size).toBeGreaterThanOrEqual(15);
  });

  it('couvre les régions attendues, avec des robes et des formes cohérentes', () => {
    const attendu: [string[], Partial<Pick<Bottle, 'robe' | 'forme'>>][] = [
      // Bordeaux rive gauche
      [['Haut-Médoc', 'Médoc', 'Pauillac', 'Saint-Julien', 'Saint-Estèphe', 'Margaux', 'Moulis-en-Médoc'], { robe: 'rouge', forme: 'bordeaux' }],
      // Bordeaux rive droite
      [['Saint-Émilion Grand Cru', 'Fronsac', 'Francs Côtes de Bordeaux'], { robe: 'rouge', forme: 'bordeaux' }],
      [['Sauternes'], { robe: 'blanc-liquoreux', forme: 'bordeaux' }],
      // Bourgogne rouge et blanc
      [['Gevrey-Chambertin', 'Volnay', 'Mercurey'], { robe: 'rouge', forme: 'bourgogne' }],
      [['Chablis Premier Cru', 'Puligny-Montrachet'], { robe: 'blanc', forme: 'bourgogne' }],
      // Rhône, Loire
      [['Côte-Rôtie', 'Châteauneuf-du-Pape'], { robe: 'rouge', forme: 'bourgogne' }],
      [['Sancerre', 'Muscadet Sèvre et Maine'], { robe: 'blanc', forme: 'bourgogne' }],
      [['Chinon', 'Saumur-Champigny'], { robe: 'rouge' }],
      // Alsace : flûtes
      [['Alsace'], { forme: 'autre' }],
      // Effervescents
      [['Champagne', 'Prosecco'], { forme: 'champagne' }],
      [['Côtes de Provence'], { robe: 'rose' }],
      // Étrangers
      [['Barolo'], { robe: 'rouge' }],
      [['Rioja'], { robe: 'rouge' }],
    ];
    for (const [appellations, proprietes] of attendu) {
      for (const appellation of appellations) {
        const found = withAppellation(appellation);
        expect(found.length, appellation).toBeGreaterThan(0);
        for (const b of found) expect(b, `${b.chateau} (${appellation})`).toMatchObject(proprietes);
      }
    }
    // Champagne millésimé et non millésimé.
    const champagnes = withAppellation('Champagne');
    expect(champagnes.some((b) => b.annee !== null)).toBe(true);
    expect(champagnes.some((b) => b.annee === null)).toBe(true);
    // Seuls les effervescents sont en bouteille champenoise.
    for (const b of bottles) expect(b.forme === 'champagne').toBe(['Champagne', 'Prosecco'].includes(b.appellation));
  });

  it('décrit de la même façon toutes les bouteilles d’un même vin', () => {
    const parVin = new Map<string, Set<string>>();
    for (const b of bottles) {
      const identites = parVin.get(wineKey(b)) ?? new Set<string>();
      identites.add(identityKey(b));
      parVin.set(wineKey(b), identites);
    }
    for (const [vin, identites] of parVin) expect(identites.size, vin).toBe(1);
  });

  it('comporte des lots de 2 à 6 bouteilles identiques', () => {
    const tailles = lots().map((lot) => lot.length);
    expect(Math.max(...tailles)).toBe(6);
    expect(tailles.filter((t) => t >= 2).length).toBeGreaterThanOrEqual(20);
    expect(tailles.filter((t) => t >= 4).length).toBeGreaterThanOrEqual(3);
  });

  it('est volontairement en désordre : lots dispersés et millésimes mélangés', () => {
    const multiples = lots().filter((lot) => lot.length >= 2);
    const disperses = multiples.filter((lot) => !contiguous(lot));
    expect(disperses.length).toBeGreaterThanOrEqual(12);
    // Des lots éclatés sur plusieurs clayettes.
    expect(disperses.filter((lot) => new Set(lot.map((b) => b.clayette)).size >= 2).length).toBeGreaterThanOrEqual(8);

    // Dans l'ordre de lecture, l'année « redescend » très souvent (une cave rangée irait croissant).
    const annees = bottles.flatMap((b) => (b.annee === null ? [] : [b.annee]));
    const inversions = annees.filter((annee, i) => i > 0 && annee < (annees[i - 1] ?? annee)).length;
    expect(inversions).toBeGreaterThanOrEqual(25);

    // Des bouteilles « champagne » et « bordeaux » traînent sur les clayettes « tout ».
    const surTout = bottles.filter((b) => cellar.shelves[b.clayette - 1]?.type === 'tout');
    expect(surTout.some((b) => b.forme === 'champagne')).toBe(true);
    expect(surTout.some((b) => b.forme === 'bordeaux')).toBe(true);
    expect(surTout.some((b) => b.forme === 'bourgogne')).toBe(true);
  });
});

describe('demoCellar', () => {
  it('renvoie une nouvelle cave à chaque appel, identique (identifiants « ex-… » fixes et uniques)', () => {
    const autre = demoCellar();
    expect(autre).not.toBe(cellar);
    expect(autre).toEqual(cellar);
    const ids = new Set(cellar.bottles.map((b) => b.id));
    expect(ids.size).toBe(cellar.bottles.length);
    expect([...ids].every((id) => /^ex-\d{3}$/.test(id))).toBe(true);
  });
});

describe('public/exemple-cave.csv', () => {
  const bytes = readFileSync(PUBLIC_FILE);

  it('commence par un BOM UTF-8', () => {
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  });

  it('est identique à DEMO_CSV, au BOM près', () => {
    expect(bytes.subarray(3).toString('utf8')).toBe(DEMO_CSV);
  });

  it('se lit tel quel, sans erreur ni avertissement', () => {
    const result = parseCellarCsv(bytes.toString('utf8'));
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.cellar && serializeCellar(result.cellar)).toBe(DEMO_CSV);
  });
});
