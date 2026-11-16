import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseCellarCsv } from '../domain/csv';
import { referenceCellar } from '../domain/reference';
import { readTextFile } from './transfer';
import { isXlsx, xlsxToCsv } from './xlsx';

const FIXTURE = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures/cave-origine-2026-11-14.xlsx');

describe('classeur Excel (.xlsx)', () => {
  const bytes = new Uint8Array(readFileSync(FIXTURE));

  it('est reconnu à sa signature', () => {
    expect(isXlsx(bytes)).toBe(true);
    expect(isXlsx(new TextEncoder().encode('type;id;capacite\r\n'))).toBe(false);
  });

  it('le classeur d’origine se convertit en CSV et donne la cave de référence', async () => {
    const csv = await xlsxToCsv(bytes);
    expect(csv.split('\r\n')[0]).toBe(
      'type;id;capacite;type_clayette;nom;appellation;millesime;cepages;robe;forme;clayette;place;collection',
    );
    const result = parseCellarCsv(csv);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    const attendu = referenceCellar();
    const tri = <T extends { clayette: number; rang: number }>(list: T[]): T[] =>
      [...list].sort((a, b) => a.clayette - b.clayette || a.rang - b.rang);
    expect(result.cellar?.shelves).toEqual(attendu.shelves);
    expect(tri(result.cellar?.bottles ?? [])).toEqual(tri(attendu.bottles));
  });

  it('readTextFile convertit le classeur à la volée', async () => {
    const text = await readTextFile(new Blob([bytes]));
    expect(parseCellarCsv(text).cellar?.bottles).toHaveLength(139);
  });

  it('signale une archive illisible', async () => {
    await expect(xlsxToCsv(bytes.subarray(0, 200))).rejects.toThrow(/Classeur Excel illisible/);
  });
});
