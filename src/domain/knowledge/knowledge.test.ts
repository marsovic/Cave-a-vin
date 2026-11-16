import { describe, expect, it } from 'vitest';
import { norm } from '../normalize';
import { FORMES, ROBES } from '../types';
import { APPELLATIONS, appellationNames, cepageNames, findAppellation, genericGarde, suggestWineDefaults } from './index';
import { DISH_RULES, PROFILES } from './pairing-rules';

describe('base d\'appellations', () => {
  it('contient au moins 200 fiches aux noms uniques', () => {
    expect(APPELLATIONS.length).toBeGreaterThanOrEqual(200);
    const names = APPELLATIONS.map((a) => norm(a.nom));
    expect(new Set(names).size).toBe(names.length);
    expect(appellationNames()).toHaveLength(APPELLATIONS.length);
  });

  it('chaque fiche est cohérente', () => {
    const known = new Set(cepageNames().map(norm));
    for (const a of APPELLATIONS) {
      expect(a.robes.length, a.nom).toBeGreaterThan(0);
      expect(FORMES, a.nom).toContain(a.forme);
      for (const robe of a.robes) {
        expect(ROBES, a.nom).toContain(robe);
        const garde = a.garde[robe];
        expect(garde, `${a.nom} ${robe}`).toBeDefined();
        const [debut, fin] = garde!;
        expect(debut, a.nom).toBeGreaterThanOrEqual(0);
        expect(fin, a.nom).toBeGreaterThanOrEqual(debut);
        expect(fin, a.nom).toBeLessThanOrEqual(80);
        const cepages = a.cepages[robe];
        expect(cepages?.length, `${a.nom} ${robe}`).toBeGreaterThan(0);
        for (const c of cepages!) expect(known.has(norm(c)), `${a.nom} : ${c}`).toBe(true);
      }
      // Les effervescents sont en bouteille champenoise.
      if (a.effervescent) expect(a.forme, a.nom).toBe('champagne');
    }
  });

  it('un alias ne masque jamais le nom d\'une autre appellation', () => {
    const canonical = new Map(APPELLATIONS.map((a) => [norm(a.nom), a.nom]));
    for (const a of APPELLATIONS) {
      for (const alias of a.alias ?? []) {
        const owner = canonical.get(norm(alias));
        expect(owner === undefined || owner === a.nom, `${alias} (alias de ${a.nom}) est aussi ${owner}`).toBe(true);
      }
    }
  });

  it('connaît au moins 80 cépages', () => {
    expect(cepageNames().length).toBeGreaterThanOrEqual(80);
  });
});

describe('recherche d\'appellation', () => {
  const name = (q: string): string | undefined => findAppellation(q)?.nom;

  it('tolère casse, accents, tirets, abréviations et mentions', () => {
    expect(name('haut medoc')).toBe('Haut-Médoc');
    expect(name('HAUT-MÉDOC')).toBe('Haut-Médoc');
    expect(name('St-Emilion')).toBe('Saint-Émilion');
    expect(name('Saint Emilion Grand Cru')).toBe('Saint-Émilion Grand Cru');
    expect(name('Chateauneuf du Pape')).toBe('Châteauneuf-du-Pape');
    expect(name('AOC Pessac-Léognan')).toBe('Pessac-Léognan');
    expect(name('Appellation Margaux Contrôlée')).toBe('Margaux');
    expect(name('Chablis 1er Cru')).toBe('Chablis Premier Cru');
    expect(name('Morgon Vieilles Vignes')).toBe('Morgon');
    expect(name('Champagne Brut')).toBe('Champagne');
    expect(name('Côtes de Provence rosé')).toBe('Côtes de Provence');
    expect(name('Moulis')).toBe('Moulis-en-Médoc');
  });

  it('ne confond pas les appellations proches', () => {
    expect(name('Pouilly-Fumé')).toBe('Pouilly-Fumé');
    expect(name('Pouilly-Fuissé')).toBe('Pouilly-Fuissé');
    expect(name('Saint-Estèphe')).toBe('Saint-Estèphe');
    expect(name('Bordeaux')).toBe('Bordeaux');
    expect(name('Bordeaux Supérieur')).toBe('Bordeaux Supérieur');
    expect(name('Petit Chablis')).toBe('Petit Chablis');
    expect(name('Chablis')).toBe('Chablis');
    expect(name('Barbera d\'Asti')).toBe('Barbera d\'Asti');
    expect(name('Muscat de Rivesaltes')).toBe('Muscat de Rivesaltes');
  });

  it('préfère le nom le plus long contenu dans la saisie aux mentions retirées', () => {
    expect(name('Chianti Classico Riserva')).toBe('Chianti Classico');
    expect(name('Saint-Émilion 1er Grand Cru Classé')).toBe('Saint-Émilion Grand Cru');
    expect(name('Saint-Émilion Premier Grand Cru Classé')).toBe('Saint-Émilion Grand Cru');
    expect(name('Rioja Reserva')).toBe('Rioja');
    expect(name('Médoc Cru Bourgeois')).toBe('Médoc');
  });

  it('un nom très court ne capture pas une autre appellation', () => {
    expect(name('Grignolino d\'Asti')).toBeUndefined();
    expect(name('Dolcetto d\'Asti')).toBe('Dolcetto d\'Alba');
    expect(name('Corse Porto-Vecchio')).not.toBe('Porto');
    expect(name('Port')).toBe('Porto');
    expect(name('Muscat de Frontignan')).toBe('Muscat de Frontignan');
  });

  it('refuse les saisies ambiguës ou inconnues', () => {
    expect(name('pouilly')).toBeUndefined();
    expect(name('saint')).toBeUndefined();
    expect(name('zz')).toBeUndefined();
    expect(name('Appellation inconnue')).toBeUndefined();
    expect(name('chateauneuf')).toBe('Châteauneuf-du-Pape');
  });
});

describe('valeurs déduites', () => {
  it('propose robe, forme et cépages habituels', () => {
    expect(suggestWineDefaults('Margaux')).toMatchObject({ robe: 'rouge', forme: 'bordeaux' });
    expect(suggestWineDefaults('Margaux').cepages).toContain('Cabernet Sauvignon');
    expect(suggestWineDefaults('Sauternes')).toMatchObject({ robe: 'blanc-liquoreux', forme: 'bordeaux' });
    expect(suggestWineDefaults('Chablis')).toMatchObject({ robe: 'blanc', forme: 'bourgogne', cepages: ['Chardonnay'] });
    expect(suggestWineDefaults('Champagne')).toMatchObject({ forme: 'champagne' });
    expect(suggestWineDefaults('Alsace Riesling')).toMatchObject({ forme: 'autre' });
    expect(suggestWineDefaults('Inconnue')).toEqual({});
  });

  it('adapte les cépages à la robe imposée', () => {
    expect(suggestWineDefaults('Sancerre', 'rouge').cepages).toEqual(['Pinot noir']);
    expect(suggestWineDefaults('Sancerre', 'blanc').cepages).toEqual(['Sauvignon blanc']);
  });

  it('garde générique selon la robe et les cépages', () => {
    expect(genericGarde({ robe: 'rose', cepages: [] })).toEqual([0, 2]);
    expect(genericGarde({ robe: 'rouge', cepages: ['Cabernet Sauvignon'] })[1]).toBeGreaterThan(genericGarde({ robe: 'rouge', cepages: ['Gamay'] })[1]);
    expect(genericGarde({ robe: 'blanc-liquoreux', cepages: [] })[1]).toBeGreaterThanOrEqual(20);
    expect(genericGarde({ robe: 'blanc-liquoreux', cepages: ['Muscat à petits grains'] })).toEqual([0, 5]);
  });
});

describe('règles d\'accords', () => {
  it('chaque règle note tous les profils entre 0 et 100, avec des identifiants uniques', () => {
    expect(new Set(DISH_RULES.map((r) => r.id)).size).toBe(DISH_RULES.length);
    expect(DISH_RULES.length).toBeGreaterThanOrEqual(40);
    for (const rule of DISH_RULES) {
      expect(rule.scores, rule.id).toHaveLength(PROFILES.length);
      for (const score of rule.scores) {
        expect(score, rule.id).toBeGreaterThanOrEqual(0);
        expect(score, rule.id).toBeLessThanOrEqual(100);
      }
      for (const mot of rule.mots) expect(mot.replace(/\$$/, ''), `${rule.id} : ${mot}`).toBe(norm(mot.replace(/\$$/, '')));
      for (const [pattern] of rule.bonus ?? []) expect(pattern, `${rule.id} : ${pattern}`).toBe(norm(pattern));
    }
  });
});
