import { describe, expect, it } from 'vitest';
import { validateAiRequest } from '../../shared/groq.js';
import { asInteger, asNumber, asOneOf, asText, asTextArray, clamp, extractJson, findArray, isRecord, truncate } from './json';
import {
  LABEL_SCHEMA,
  PAIRINGS_SCHEMA,
  WINDOWS_SCHEMA,
  describeWine,
  labelMessages,
  oneLine,
  pairingMessages,
  pairingWebMessages,
  windowsMessages,
  windowsWebMessages,
} from './prompts';
import type { WineFields } from '../domain/types';
import type { AiMessage } from './types';

describe('extractJson', () => {
  it('lit un JSON seul (objet ou tableau)', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
    expect(extractJson('  [1, 2, 3]\n')).toEqual([1, 2, 3]);
    expect(extractJson('﻿{"a":"é"}')).toEqual({ a: 'é' });
  });

  it('lit un bloc ```json', () => {
    expect(extractJson('Voici la réponse :\n```json\n{"a": [1, 2]}\n```\nBonne dégustation !')).toEqual({ a: [1, 2] });
    expect(extractJson('```\n[{"i":0}]\n```')).toEqual([{ i: 0 }]);
    expect(extractJson('```JSON\n{"a":1}```')).toEqual({ a: 1 });
  });

  it('lit un JSON entouré de texte', () => {
    expect(extractJson('Bien sûr ! {"score": 80, "raison": "Bel accord"} Voilà.')).toEqual({
      score: 80,
      raison: 'Bel accord',
    });
    expect(extractJson('Résultat : [{"i":0},{"i":1}] (2 vins)')).toEqual([{ i: 0 }, { i: 1 }]);
  });

  it('prend le premier objet ou tableau équilibré', () => {
    expect(extractJson('{"a":1} puis {"b":2}')).toEqual({ a: 1 });
    expect(extractJson('{"a":{"b":[1,{"c":2}]}} fin')).toEqual({ a: { b: [1, { c: 2 }] } });
  });

  it('ignore les accolades et crochets placés dans des chaînes', () => {
    expect(extractJson('Texte {"note":"accolade } et crochet ] dans \\"la\\" chaîne","n":1} suite')).toEqual({
      note: 'accolade } et crochet ] dans "la" chaîne',
      n: 1,
    });
  });

  it('saute un faux départ pour trouver le JSON valide suivant', () => {
    expect(extractJson('Le vin {excellent} mérite {"score": 90}')).toEqual({ score: 90 });
    expect(extractJson('Un bloc vide ``` ``` puis {"a":1}')).toEqual({ a: 1 });
  });

  it('renvoie null si rien n\'est exploitable', () => {
    for (const text of ['', '   ', 'Désolé, je ne peux pas répondre.', '{"a":', '{a:1}', '42', '"texte"', 'null', 'true']) {
      expect(extractJson(text)).toBeNull();
    }
    expect(extractJson(undefined as unknown as string)).toBeNull();
  });
});

describe('validateurs', () => {
  it('isRecord', () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord([])).toBe(false);
    expect(isRecord(null)).toBe(false);
    expect(isRecord('x')).toBe(false);
  });

  it('asText nettoie les espaces et refuse le vide', () => {
    expect(asText('  Château   Margaux \n')).toBe('Château Margaux');
    expect(asText('   ')).toBeNull();
    expect(asText(12)).toBeNull();
    expect(asText(null)).toBeNull();
  });

  it('asInteger', () => {
    expect(asInteger(2015)).toBe(2015);
    expect(asInteger('2015')).toBe(2015);
    expect(asInteger(' 2015 ')).toBe(2015);
    expect(asInteger(2015.5)).toBeNull();
    expect(asInteger('2015.5')).toBeNull();
    expect(asInteger('vers 2015')).toBeNull();
    expect(asInteger(Number.NaN)).toBeNull();
    expect(asInteger(null)).toBeNull();
  });

  it('asNumber', () => {
    expect(asNumber(72.5)).toBe(72.5);
    expect(asNumber('72,5')).toBe(72.5);
    expect(asNumber('80')).toBe(80);
    expect(asNumber(Number.POSITIVE_INFINITY)).toBeNull();
    expect(asNumber('beaucoup')).toBeNull();
    expect(asNumber(undefined)).toBeNull();
  });

  it('asTextArray', () => {
    expect(asTextArray([' Merlot ', '', 3, null, 'Cabernet  franc'])).toEqual(['Merlot', 'Cabernet franc']);
    expect(asTextArray('Merlot')).toEqual([]);
    expect(asTextArray(undefined)).toEqual([]);
  });

  it('asOneOf', () => {
    const robes = ['rouge', 'blanc'] as const;
    expect(asOneOf('rouge', robes)).toBe('rouge');
    expect(asOneOf('vert', robes)).toBeNull();
    expect(asOneOf(null, robes)).toBeNull();
  });

  it('clamp et truncate', () => {
    expect(clamp(150, 0, 100)).toBe(100);
    expect(clamp(-5, 0, 100)).toBe(0);
    expect(clamp(42, 0, 100)).toBe(42);
    expect(truncate('court', 10)).toBe('court');
    expect(truncate('un texte nettement trop long', 10)).toBe('un texte…');
    expect(truncate('abcdefghijklmnop', 10)).toBe('abcdefghi…');
    expect(truncate('abcdefghij', 10)).toBe('abcdefghij');
  });

  it('findArray', () => {
    expect(findArray([1], 'x')).toEqual([1]);
    expect(findArray({ x: [1], y: [2] }, 'x')).toEqual([1]);
    expect(findArray({ resultats: [3] }, 'x')).toEqual([3]);
    expect(findArray({ a: [1], b: [2] }, 'x')).toBeNull();
    expect(findArray({ x: 'non' }, 'x')).toBeNull();
    expect(findArray('texte', 'x')).toBeNull();
  });
});

/** Vérifie les règles du mode strict de Groq sur tout le schéma. */
function expectStrict(schema: unknown, path = 'racine'): void {
  if (!isRecord(schema)) throw new Error(`${path} : schéma attendu`);
  if (Array.isArray(schema.anyOf)) {
    schema.anyOf.forEach((option, index) => expectStrict(option, `${path}.anyOf[${index}]`));
    return;
  }
  if (schema.type === 'object') {
    expect(schema.additionalProperties, `${path}.additionalProperties`).toBe(false);
    const properties = schema.properties;
    if (!isRecord(properties)) throw new Error(`${path} : properties attendu`);
    expect([...(schema.required as string[])].sort(), `${path}.required`).toEqual(Object.keys(properties).sort());
    for (const [name, child] of Object.entries(properties)) expectStrict(child, `${path}.${name}`);
  } else if (schema.type === 'array') {
    expectStrict(schema.items, `${path}[]`);
  } else {
    expect(['string', 'integer', 'number', 'boolean', 'null'], `${path}.type`).toContain(schema.type);
  }
}

const WINE: WineFields = {
  chateau: 'Château  Margaux',
  appellation: 'Margaux',
  annee: 2015,
  cepages: ['Cabernet sauvignon', 'Merlot'],
  robe: 'rouge',
  forme: 'bordeaux',
};

function textOf(messages: AiMessage[]): string {
  return messages
    .map((message) =>
      typeof message.content === 'string'
        ? message.content
        : message.content.map((part) => (part.type === 'text' ? part.text : '')).join('\n'),
    )
    .join('\n');
}

describe('schémas JSON', () => {
  it.each([
    ['étiquette', LABEL_SCHEMA],
    ['fenêtres', WINDOWS_SCHEMA],
    ['accords', PAIRINGS_SCHEMA],
  ])('schéma %s : strict et accepté par la validation', (_label, schema) => {
    expect(schema.name).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);
    expect(schema.schema.type).toBe('object');
    expectStrict(schema.schema);
    const checked = validateAiRequest({ role: 'texte', messages: [{ role: 'user', content: 'x' }], json: schema });
    expect(checked.ok).toBe(true);
  });

  it('schéma étiquette : champs et énumérations attendus', () => {
    const properties = LABEL_SCHEMA.schema.properties as Record<string, unknown>;
    expect(Object.keys(properties).sort()).toEqual(
      ['annee', 'appellation', 'cepages', 'cepages_deduits', 'chateau', 'forme', 'lisible', 'note', 'robe'].sort(),
    );
    expect(properties.annee).toEqual({ anyOf: [{ type: 'integer' }, { type: 'null' }] });
    expect(properties.robe).toEqual({
      anyOf: [{ type: 'string', enum: ['rouge', 'blanc', 'blanc-liquoreux', 'rose'] }, { type: 'null' }],
    });
    expect(properties.forme).toEqual({
      anyOf: [{ type: 'string', enum: ['bordeaux', 'bourgogne', 'champagne', 'autre'] }, { type: 'null' }],
    });
    expect(properties.cepages).toEqual({ type: 'array', items: { type: 'string' } });
  });
});

describe('consignes', () => {
  it('oneLine ramène une saisie à une ligne bornée', () => {
    expect(oneLine('  Château\n\tMargaux  ', 80)).toBe('Château Margaux');
    expect(oneLine('x'.repeat(100), 20)).toHaveLength(20);
  });

  it('describeWine décrit un vin sur une ligne numérotée', () => {
    expect(describeWine(WINE, 3)).toBe('[3] Château Margaux — Margaux — 2015 — rouge — cépages : Cabernet sauvignon, Merlot');
    expect(describeWine({ ...WINE, annee: null, cepages: [], robe: 'blanc-liquoreux', chateau: '', appellation: ' ' }, 0)).toBe(
      '[0] producteur inconnu — appellation inconnue — non millésimé — blanc liquoreux',
    );
    expect(describeWine({ ...WINE, robe: 'rose' }, 1)).toContain('rosé');
  });

  it('étiquette : message système en texte, photo dans le message utilisateur, mot JSON présent', () => {
    const url = 'data:image/jpeg;base64,AAAA';
    const messages = labelMessages(url);
    expect(messages).toHaveLength(2);
    expect(typeof messages[0]!.content).toBe('string');
    expect(messages[1]!.role).toBe('user');
    expect(messages[1]!.content).toContainEqual({ type: 'image_url', image_url: { url } });
    const text = textOf(messages);
    expect(text).toContain('JSON');
    expect(text).toMatch(/n'invente JAMAIS/);
    expect(validateAiRequest({ role: 'vision', messages, json: LABEL_SCHEMA }).ok).toBe(true);
  });

  it('fenêtres : année courante, liste des vins, contexte web facultatif', () => {
    const sans = textOf(windowsMessages([WINE, { ...WINE, annee: 2018 }], 2026));
    expect(sans).toContain('Nous sommes en 2026');
    expect(sans).toContain('[0] Château Margaux — Margaux — 2015');
    expect(sans).toContain('[1] Château Margaux — Margaux — 2018');
    expect(sans).toContain('JSON');
    expect(sans).not.toContain('internet');
    const avec = textOf(windowsMessages([WINE], 2026, 'Apogée 2025-2040 selon la RVF.'));
    expect(avec).toContain('Apogée 2025-2040 selon la RVF.');
    expect(avec).toContain('internet');
  });

  it('recherche web des fenêtres : texte libre, vins listés', () => {
    const messages = windowsWebMessages([WINE], 2026);
    expect(validateAiRequest({ role: 'web', messages }).ok).toBe(true);
    const text = textOf(messages);
    expect(text).toContain('[0] Château Margaux');
    expect(text).toMatch(/fenêtre de dégustation|apogée/);
  });

  it('accords : plat, année courante, détail de chaque vin', () => {
    const text = textOf(pairingMessages('  Magret de canard\naux cerises ', [WINE, { ...WINE, annee: null, robe: 'blanc' }], 2026));
    expect(text).toContain('« Magret de canard aux cerises »');
    expect(text).toContain('Nous sommes en 2026');
    expect(text).toContain('[0] Château Margaux — Margaux — 2015 — rouge — cépages : Cabernet sauvignon, Merlot');
    expect(text).toContain('non millésimé — blanc');
    expect(text).toContain('JSON');
    expect(textOf(pairingMessages('Plat', [WINE], 2026, 'Préférer un rouge charpenté.'))).toContain('Préférer un rouge charpenté.');
  });

  it('recherche web des accords : cite le plat (borné à 200 caractères)', () => {
    const text = textOf(pairingWebMessages(`Blanquette de veau ${'très '.repeat(100)}bonne`));
    expect(text).toContain('Blanquette de veau');
    expect(text).toContain('appellations');
    expect(text.length).toBeLessThan(700);
  });
});
