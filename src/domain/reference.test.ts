import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { cellarStats, defaultCellar, isCompatible, validateCellar } from './cellar';
import { looksLikeCellarCsv, parseCellarCsv, serializeCellar } from './csv';
import { findWineAppellation } from './knowledge';
import { applyReorgStep, planReorganization, sameCellarContent, type ReorgState } from './reorg';
import { REFERENCE_CSV, referenceCellar } from './reference';

const PUBLIC_FILE = resolve(dirname(fileURLToPath(import.meta.url)), '../../public/cave-bacchus.csv');

describe('cave de référence (armoire modélisée)', () => {
  const cellar = referenceCellar();

  it('se lit sans erreur ni avertissement et se réécrit à l’identique', () => {
    const result = parseCellarCsv(REFERENCE_CSV);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(looksLikeCellarCsv(REFERENCE_CSV)).toBe(true);
    expect(serializeCellar(cellar)).toBe(REFERENCE_CSV);
  });

  it('décrit l’armoire : 9 × 13 bordeaux, 1 × 12 bourgogne, 1 × 10 champagne', () => {
    expect(cellar.shelves).toEqual(defaultCellar().shelves);
    expect(cellarStats(cellar)).toMatchObject({ capacite: 139, total: 139 });
    expect(validateCellar(cellar)).toEqual([]);
  });

  it('contient les 139 bouteilles du fichier d’origine, identifiants conservés', () => {
    expect(cellar.bottles).toHaveLength(139);
    expect(new Set(cellar.bottles.map((b) => b.id)).size).toBe(139);
    expect(cellar.bottles.every((b) => /^[0-9a-f-]{36}$/.test(b.id))).toBe(true);
    expect(cellar.bottles.filter((b) => b.collection)).toHaveLength(13);
    expect(cellar.bottles.filter((b) => b.annee === null)).toHaveLength(11);
    const robes = Object.groupBy(cellar.bottles, (b) => b.robe);
    expect([robes.rouge?.length, robes.blanc?.length, robes['blanc-liquoreux']?.length, robes.rose?.length]).toEqual([
      111, 22, 5, 1,
    ]);
    const formes = Object.groupBy(cellar.bottles, (b) => b.forme);
    expect([formes.bordeaux?.length, formes.bourgogne?.length, formes.champagne?.length]).toEqual([117, 12, 10]);
    expect(cellar.bottles.find((b) => b.clayette === 1 && b.rang === 2)).toMatchObject({
      id: '5b4de640-fb29-43e6-8a7c-3759285376fc',
      chateau: 'Château Tayac',
      appellation: 'Margaux',
      annee: 1975,
      collection: true,
    });
  });

  it('respecte les types de clayettes', () => {
    for (const b of cellar.bottles) {
      expect(isCompatible(b.forme, cellar.shelves[b.clayette - 1]!.type)).toBe(true);
    }
  });

  it('public/cave-bacchus.csv en est la copie exacte, précédée d’un BOM', () => {
    const text = readFileSync(PUBLIC_FILE).toString('utf8');
    expect(text.charCodeAt(0)).toBe(0xfeff);
    expect(text.slice(1)).toBe(REFERENCE_CSV);
  });

  it('la réorganisation automatique sait la trier alors qu’elle est pleine', () => {
    for (const mode of ['economique', 'compact'] as const) {
      const plan = planReorganization(cellar, { mode });
      expect(plan.steps.length).toBeGreaterThan(0);
      expect(validateCellar(plan.target)).toEqual([]);
      expect(plan.target.bottles).toHaveLength(139);
      // Les étapes, jouées une à une, mènent bien au rangement annoncé.
      let state: ReorgState = { cellar, horsCave: [] };
      for (const step of plan.steps) {
        const next = applyReorgStep(state, step);
        if (!next.ok) throw new Error(next.error);
        state = next.value;
      }
      expect(state.horsCave).toEqual([]);
      expect(sameCellarContent(state.cellar, plan.target)).toBe(true);
      console.info(mode, plan.steps.length, JSON.stringify(plan.stats), plan.notes.slice(0, 3));
    }
  });

  it('toutes les bouteilles ont une appellation connue de la base (fenêtres de garde)', () => {
    const inconnues = cellar.bottles.filter((b) => !findWineAppellation(b)).map((b) => `${b.chateau} / ${b.appellation}`);
    expect([...new Set(inconnues)]).toEqual([]);
  });
});
