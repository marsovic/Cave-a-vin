import { describe, expect, it } from 'vitest';
import {
  describeWindow,
  distinctWines,
  drinkStatus,
  estimateDrinkWindow,
  localPairing,
  recognizeDish,
  reportCollectionCandidates,
  reportDrinkSoon,
  reportPairing,
  reportPrioritize,
  wineProfile,
  type Pairing,
} from './advisor';
import { wineKey } from './normalize';
import { cellarWith, shelves, wine } from './testing';
import type { DrinkWindow } from './types';

const win = (debut: number, fin: number): DrinkWindow => ({ debut, fin, source: 'local' });

describe('fenêtre de dégustation', () => {
  it('s\'appuie sur l\'appellation et la robe', () => {
    expect(estimateDrinkWindow(wine({ appellation: 'Margaux', annee: 2010 }))).toMatchObject({ debut: 2018, fin: 2035, source: 'local' });
    expect(estimateDrinkWindow(wine({ appellation: 'Sauternes', robe: 'blanc-liquoreux', annee: 2005 }))).toMatchObject({ debut: 2013, fin: 2045 });
    expect(estimateDrinkWindow(wine({ appellation: 'Côtes de Provence', robe: 'rose', annee: 2024 }))).toMatchObject({ debut: 2024, fin: 2026 });
  });

  it('retombe sur une estimation générale si l\'appellation est inconnue, et rien sans millésime', () => {
    const w = estimateDrinkWindow(wine({ appellation: 'Vin de pays inconnu', cepages: ['Gamay'], annee: 2020 }));
    expect(w).toMatchObject({ debut: 2022, fin: 2027 });
    expect(w?.note).toMatch(/Estimation générale/);
    expect(estimateDrinkWindow(wine({ annee: null }))).toBeNull();
  });

  it('statut : bornes exactes', () => {
    const w = win(2015, 2025); // durée 10 → seuil d'urgence 2 ans
    expect(drinkStatus(w, 2014)).toBe('trop-jeune');
    expect(drinkStatus(w, 2015)).toBe('a-boire');
    expect(drinkStatus(w, 2022)).toBe('a-boire');
    expect(drinkStatus(w, 2023)).toBe('a-boire-vite');
    expect(drinkStatus(w, 2025)).toBe('a-boire-vite');
    expect(drinkStatus(w, 2026)).toBe('passe');
    expect(drinkStatus(null, 2026)).toBe('inconnu');
    // Fenêtre courte : au moins un an d'urgence.
    expect(drinkStatus(win(2024, 2026), 2025)).toBe('a-boire-vite');
    expect(drinkStatus(win(2024, 2026), 2024)).toBe('a-boire');
  });

  it('se décrit en français', () => {
    expect(describeWindow(win(2030, 2040), 2026)).toMatch(/attendre encore 4 ans/);
    expect(describeWindow(win(2015, 2027), 2026)).toMatch(/avant fin 2027/);
    expect(describeWindow(win(2015, 2026), 2026)).toMatch(/cette année/);
    expect(describeWindow(win(2008, 2020), 2026)).toMatch(/dépassée depuis 6 ans/);
    expect(describeWindow(null, 2026)).toMatch(/Non millésimé/);
  });
});

describe('profil et accords locaux', () => {
  const pauillac = wine({ appellation: 'Pauillac' });
  const morgon = wine({ appellation: 'Morgon', cepages: ['Gamay'], forme: 'bourgogne' });
  const sancerre = wine({ appellation: 'Sancerre', cepages: ['Sauvignon blanc'], robe: 'blanc', forme: 'bourgogne' });
  const meursault = wine({ appellation: 'Meursault', cepages: ['Chardonnay'], robe: 'blanc', forme: 'bourgogne' });
  const sauternes = wine({ appellation: 'Sauternes', cepages: ['Sémillon'], robe: 'blanc-liquoreux' });
  const champagne = wine({ appellation: 'Champagne', cepages: ['Chardonnay'], robe: 'blanc', forme: 'champagne' });
  const gewurz = wine({ appellation: 'Alsace Gewurztraminer', cepages: ['Gewurztraminer'], robe: 'blanc', forme: 'autre' });
  const banyuls = wine({ appellation: 'Banyuls', cepages: ['Grenache'] });
  const rose = wine({ appellation: 'Côtes de Provence', cepages: ['Grenache'], robe: 'rose' });
  const all = { pauillac, morgon, sancerre, meursault, sauternes, champagne, gewurz, banyuls, rose };

  it('déduit le profil du vin', () => {
    expect(wineProfile(pauillac)).toBe('rougePuissant');
    expect(wineProfile(morgon)).toBe('rougeLeger');
    expect(wineProfile(sancerre)).toBe('blancVif');
    expect(wineProfile(meursault)).toBe('blancRond');
    expect(wineProfile(gewurz)).toBe('blancAromatique');
    expect(wineProfile(sauternes)).toBe('liquoreux');
    expect(wineProfile(champagne)).toBe('bulles');
    expect(wineProfile(banyuls)).toBe('rougeDoux');
    expect(wineProfile(rose)).toBe('rose');
    expect(wineProfile(wine({ appellation: 'Chablis', cepages: ['Chardonnay'], robe: 'blanc' }))).toBe('blancVif');
  });

  const best = (plat: string): string => {
    const ranked = Object.entries(all)
      .map(([name, w]) => [name, localPairing(plat, w).score] as const)
      .sort((a, b) => b[1] - a[1]);
    return ranked[0]![0];
  };

  it('classe en tête le type de vin attendu', () => {
    expect(best('gigot d\'agneau')).toBe('pauillac');
    expect(best('côte de bœuf grillée')).toBe('pauillac');
    expect(best('plateau d\'huîtres')).toBe('sancerre');
    expect(best('crottin de chèvre')).toBe('sancerre');
    expect(best('homard au beurre blanc')).toBe('meursault');
    expect(best('foie gras')).toBe('sauternes');
    expect(best('roquefort')).toBe('sauternes');
    expect(best('fondant au chocolat')).toBe('banyuls');
    expect(best('munster')).toBe('gewurz');
    expect(best('curry thaï')).toBe('gewurz');
    expect(best('saucisson et rillettes')).toBe('morgon');
    expect(best('apéritif')).toBe('champagne');
    expect(best('tarte aux fraises')).toBe('sauternes');
  });

  it('note bas les mauvais accords et explique en français', () => {
    expect(localPairing('gigot d\'agneau', sauternes).score).toBeLessThan(30);
    expect(localPairing('huîtres', pauillac).score).toBeLessThan(30);
    const p = localPairing('gigot d\'agneau', pauillac);
    expect(p.score).toBeGreaterThanOrEqual(85);
    expect(p.raison).toMatch(/rouge charpenté \(Pauillac\).*agneau/);
    expect(p.source).toBe('local');
  });

  it('reconnaît les plats sans faux amis', () => {
    const ids = (plat: string): string[] => recognizeDish(plat).map((r) => r.id);
    expect(ids('pâtes à la bolognaise')).toContain('italien');
    expect(ids('pâté en croûte')).toContain('porc');
    expect(ids('pâté en croûte')).not.toContain('italien');
    expect(ids('tarte flambée')).toContain('choucroute');
    expect(ids('bar grillé')).toContain('poisson');
    expect(ids('barbecue')).not.toContain('poisson');
    expect(ids('pomme de terre au four')).not.toContain('dessert-fruits');
    expect(ids('comté 24 mois')).toEqual(['fromage-dur']);
    expect(ids('plateau de fromages')).toEqual(['fromages']);
    expect(ids('mousse au chocolat')).toEqual(['chocolat']);
    expect(ids('xyz')).toEqual([]);
  });

  it('plat inconnu : note neutre et invitation à utiliser l\'IA', () => {
    expect(localPairing('xyzzy', pauillac)).toMatchObject({ score: 50, source: 'local' });
    expect(localPairing('xyzzy', pauillac).raison).toMatch(/assistant IA/);
  });
});

describe('rapports du sommelier', () => {
  const YEAR = 2026;
  const cellar = cellarWith(shelves([8, 'tout'], [8, 'tout']), [
    [1, 1, { chateau: 'Urgent', appellation: 'Beaujolais', cepages: ['Gamay'], annee: 2023, forme: 'bourgogne' }], // 2023–2026
    [1, 2, { chateau: 'Urgent', appellation: 'Beaujolais', cepages: ['Gamay'], annee: 2023, forme: 'bourgogne' }],
    [1, 3, { chateau: 'Jeune', appellation: 'Pauillac', annee: 2022 }], // 2032–2052
    [1, 4, { chateau: 'Passé', appellation: 'Bordeaux', annee: 2005 }], // 2007–2012
    [1, 5, { chateau: 'Passé Collection', appellation: 'Bordeaux', annee: 2004 }, true],
    [1, 6, { chateau: 'Prêt', appellation: 'Margaux', annee: 2012 }], // 2020–2037
    [2, 1, { chateau: 'Bulles', appellation: 'Champagne', annee: null, robe: 'blanc', forme: 'champagne', cepages: ['Chardonnay'] }],
    [2, 2, { chateau: 'Limite', appellation: 'Haut-Médoc', annee: 2012 }], // 2017–2027
  ]);
  const names = (items: { bottles: { chateau: string }[] }[]): string[] => items.map((i) => i.bottles[0]!.chateau);

  it('« à boire rapidement » : fin de fenêtre proche, hors collection, groupé par vin', () => {
    const report = reportDrinkSoon(cellar, YEAR);
    expect(names(report)).toEqual(['Urgent', 'Limite']);
    expect(report[0]!.bottles).toHaveLength(2);
    expect(report[0]!.status).toBe('a-boire-vite');
    expect(report[0]!.raison).toMatch(/cette année/);
  });

  it('« candidates collection » : fenêtre dépassée, jamais les bouteilles déjà en collection ni sans millésime', () => {
    const report = reportCollectionCandidates(cellar, YEAR);
    expect(names(report)).toEqual(['Passé']);
    expect(report[0]!.raison).toMatch(/dépassée depuis 14 ans/);
  });

  it('« accord » : vins adaptés au plat, les prêts à boire avant les trop jeunes ou passés', () => {
    const report = reportPairing(cellar, 'gigot d\'agneau', YEAR);
    const list = names(report);
    expect(list).toContain('Prêt');
    expect(list).not.toContain('Bulles');
    expect(list).not.toContain('Passé Collection');
    expect(list.indexOf('Prêt')).toBeLessThan(list.indexOf('Jeune'));
    expect(report.find((i) => i.bottles[0]!.chateau === 'Jeune')!.raison).toMatch(/Encore jeune/);
    expect(report.every((i) => (i.pairing?.score ?? 0) >= 60)).toBe(true);
    // Un vin sans millésime peut convenir à un plat.
    expect(names(reportPairing(cellar, 'apéritif', YEAR))).toContain('Bulles');
  });

  it('« à privilégier » : convient au plat ET à boire rapidement', () => {
    const lamb = reportPrioritize(cellar, 'gigot d\'agneau', YEAR);
    expect(names(lamb)[0]).toBe('Limite');
    expect(lamb.every((i) => i.status === 'a-boire-vite' && (i.pairing?.score ?? 0) >= 60)).toBe(true);
    expect(names(lamb)).not.toContain('Prêt');
    expect(names(reportPrioritize(cellar, 'saucisson', YEAR))).toContain('Urgent');
    expect(reportPrioritize(cellar, 'huîtres', YEAR)).toEqual([]);
  });

  it('les informations de l\'IA priment sur l\'estimation locale', () => {
    const pret = cellar.bottles.find((b) => b.chateau === 'Prêt')!;
    const windows = new Map([[wineKey(pret), { debut: 2015, fin: 2026, source: 'ia' } as DrinkWindow]]);
    expect(names(reportDrinkSoon(cellar, YEAR, { windows }))).toContain('Prêt');
    const pairings = new Map<string, Pairing>([[wineKey(pret), { score: 10, raison: 'Non.', source: 'ia' }]]);
    expect(names(reportPairing(cellar, 'gigot d\'agneau', YEAR, { pairings }))).not.toContain('Prêt');
  });

  it('vins distincts hors collection', () => {
    expect(distinctWines(cellar).map((w) => w.chateau)).toEqual(['Urgent', 'Jeune', 'Passé', 'Prêt', 'Bulles', 'Limite']);
    expect(distinctWines(cellar, { includeCollection: true })).toHaveLength(7);
  });
});
