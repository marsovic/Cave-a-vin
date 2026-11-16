import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { bottlesInReadingOrder, isCompatible, validateCellar } from './cellar';
import {
  CSV_COLUMNS,
  CSV_SEPARATOR,
  looksLikeCellarCsv,
  parseCellarCsv,
  serializeCellar,
  type CsvImportResult,
} from './csv';
import { joinCepages, splitCepages } from './normalize';
import {
  FORMES,
  ROBES,
  SHELF_LIMITS,
  TYPES_CLAYETTE,
  type Bottle,
  type Cellar,
  type Forme,
  type Shelf,
  type TypeClayette,
} from './types';

/* ------------------------------------------------------------------ */
/* Outils                                                              */
/* ------------------------------------------------------------------ */

const HEADER = CSV_COLUMNS.join(';');
// Caractères invisibles, nommés pour rester lisibles dans le source.
const BOM = String.fromCharCode(0xfeff);
const NBSP = String.fromCharCode(0xa0);
const LINE_SEPARATOR = String.fromCharCode(0x2028);
const ANNEE_MAX = new Date().getFullYear() + 1;

/** Assemble un fichier à partir de ses lignes (CRLF, ligne finale terminée). */
function file(...lines: string[]): string {
  return lines.map((line) => `${line}\r\n`).join('');
}

function sansId(bottle: Bottle): Omit<Bottle, 'id'> {
  return {
    chateau: bottle.chateau,
    appellation: bottle.appellation,
    annee: bottle.annee,
    cepages: bottle.cepages,
    robe: bottle.robe,
    forme: bottle.forme,
    collection: bottle.collection,
    clayette: bottle.clayette,
    rang: bottle.rang,
  };
}

/** Forme comparable d'une cave : identifiants retirés, bouteilles dans l'ordre de lecture. */
function comparable(cellar: Cellar): { shelves: Shelf[]; bottles: Omit<Bottle, 'id'>[] } {
  return { shelves: cellar.shelves, bottles: bottlesInReadingOrder(cellar).map(sansId) };
}

/** Vérifie la cohérence interne d'un résultat de lecture, quel qu'il soit. */
function expectCoherent(result: CsvImportResult): void {
  expect(result.errors.length > 0).toBe(result.cellar === null);
  for (const message of [...result.errors, ...result.warnings]) expect(message.trim()).not.toBe('');
  expect(result.stats.lignesIgnorees).toBeGreaterThanOrEqual(0);
  if (result.cellar) {
    expect(validateCellar(result.cellar)).toEqual([]);
    expect(result.stats.bouteilles).toBe(result.cellar.bottles.length);
    expect(result.stats.clayettes).toBe(result.cellar.shelves.length);
  } else {
    expect(result.stats.bouteilles).toBe(0);
    expect(result.stats.clayettes).toBe(0);
  }
}

/** Lit un fichier qui doit être exploitable et renvoie la cave (invariants vérifiés). */
function read(text: string): { cellar: Cellar; warnings: string[]; stats: CsvImportResult['stats'] } {
  const result = parseCellarCsv(text);
  expectCoherent(result);
  expect(result.errors).toEqual([]);
  if (!result.cellar) throw new Error('cave attendue');
  return { cellar: result.cellar, warnings: result.warnings, stats: result.stats };
}

function bottle(partial: Partial<Bottle> & Pick<Bottle, 'clayette' | 'rang'>): Bottle {
  return {
    id: `t-${partial.clayette}-${partial.rang}`,
    chateau: 'Château Test',
    appellation: 'Margaux',
    annee: 2015,
    cepages: ['Merlot'],
    robe: 'rouge',
    forme: 'bordeaux',
    collection: false,
    ...partial,
  };
}

function shelves(count: number, capacite = 12, type: TypeClayette = 'tout'): Shelf[] {
  return Array.from({ length: count }, () => ({ capacite, type }));
}

/**
 * Décodage CSV minimal et indépendant de `parseCellarCsv` (format strict écrit par
 * `serializeCellar`) : toutes les valeurs du fichier, guillemets retirés, rien d'autre.
 */
function rawCells(text: string): string[] {
  const cells: string[] = [];
  let i = 0;
  while (i < text.length) {
    let value = '';
    if (text[i] === '"') {
      i++;
      while (i < text.length) {
        if (text[i] === '"') {
          if (text[i + 1] !== '"') break;
          i++;
        }
        value += text[i];
        i++;
      }
      i++;
    } else {
      while (i < text.length && text[i] !== ';' && text[i] !== '\r') {
        value += text[i];
        i++;
      }
    }
    cells.push(value);
    i += text[i] === '\r' ? 2 : 1;
  }
  return cells;
}

/** Les avertissements contenant tous les fragments donnés. */
function matching(warnings: string[], ...fragments: string[]): string[] {
  return warnings.filter((w) => fragments.every((f) => w.includes(f)));
}

/* ------------------------------------------------------------------ */
/* Générateurs                                                         */
/* ------------------------------------------------------------------ */

const UNITES_SPECIALES = [
  ';', '"', "'", '\n', '\r', '\r\n', ',', '\t', ' ', '=', '+', '-', '@', '#', '/', '&',
  'é', 'È', 'ç', 'œ', 'ñ', 'ü', 'a', 'Z', '0', '7', '🍷', '🥂', '👨‍👩‍👧', NBSP, BOM, LINE_SEPARATOR,
];

const TEXTES_PIEGES = [
  '',
  'Château Margaux',
  "Château d'Yquem",
  'Domaine de la Romanée-Conti',
  '=1+1',
  "'=1+1",
  "''=SOMME(A1:A9)",
  '+33 6 12 34 56 78',
  '-M- Cuvée',
  '@domaine',
  ' =HYPERLINK("http://x")',
  '\t=cmd',
  "'",
  "'apostrophe en tête",
  ' espaces en bord ',
  'a;b;c',
  'dit "Le Vieux"',
  '"',
  '""',
  'ligne 1\nligne 2',
  'ligne 1\r\nligne 2\rligne 3',
  '# pas un commentaire',
  'Clos 🍷 des Lambrays',
  'bouteille',
  'clayette',
  '2015',
];

const texte: fc.Arbitrary<string> = fc.oneof(
  fc.string({ unit: fc.constantFrom(...UNITES_SPECIALES), maxLength: 10 }),
  fc.string({ unit: 'grapheme', maxLength: 12 }),
  fc.string({ unit: 'binary', maxLength: 8 }),
  fc.constantFrom(...TEXTES_PIEGES),
);

/** Cépages qui survivent tels quels à `splitCepages(joinCepages(…))` (c'est le format de la colonne). */
const CEPAGES = [
  'Merlot',
  'Cabernet Sauvignon',
  'Cabernet franc',
  'Pinot noir',
  'Sémillon',
  'Mourvèdre',
  'Côt',
  'Gewurztraminer',
  'Melon de Bourgogne',
  "Nero d'Avola",
  'Pinot "fin"',
  'Savagnin 🍇',
  '=Cinsault',
  '+Syrah',
  '-Carignan',
  '@Tannat',
  "'Grenache",
];

const anneeArb = fc.option(fc.integer({ min: 1800, max: ANNEE_MAX }), { nil: null });

interface WineDraft {
  noms: [string, string];
  annee: number | null;
  cepages: string[];
  robe: Bottle['robe'];
  forme: Forme;
  collection: boolean;
}

const wineArb: fc.Arbitrary<WineDraft> = fc.record({
  // Le domaine exige un château ou une appellation : une bouteille sans nom n'est pas relue.
  noms: fc.tuple(texte, texte).filter(([chateau, appellation]) => chateau.trim() !== '' || appellation.trim() !== ''),
  annee: anneeArb,
  cepages: fc.uniqueArray(fc.constantFrom(...CEPAGES), { maxLength: 4 }),
  robe: fc.constantFrom(...ROBES),
  forme: fc.constantFrom(...FORMES),
  collection: fc.boolean(),
});

const shelfArb: fc.Arbitrary<Shelf> = fc.record({
  capacite: fc.integer({ min: SHELF_LIMITS.minCapacity, max: SHELF_LIMITS.maxCapacity }),
  type: fc.constantFrom(...TYPES_CLAYETTE),
});

/** Caves valides quelconques, bouteilles dans un ordre arbitraire. */
const cellarArb: fc.Arbitrary<Cellar> = fc
  .array(shelfArb, { minLength: SHELF_LIMITS.minShelves, maxLength: SHELF_LIMITS.maxShelves })
  .chain((shelfList) => {
    const slots = shelfList.flatMap((shelf, i) =>
      Array.from({ length: shelf.capacite }, (_, r) => ({ clayette: i + 1, rang: r + 1, type: shelf.type })),
    );
    return fc.shuffledSubarray(slots, { maxLength: Math.min(30, slots.length) }).chain((chosen) =>
      fc.array(wineArb, { minLength: chosen.length, maxLength: chosen.length }).map((wines): Cellar => ({
        shelves: shelfList,
        bottles: chosen.map((slot, index): Bottle => {
          const wine = wines[index]!;
          return {
            id: `t${index}`,
            chateau: wine.noms[0],
            appellation: wine.noms[1],
            annee: wine.annee,
            cepages: wine.cepages,
            robe: wine.robe,
            // Sur une clayette spécialisée, la forme est celle de la clayette.
            forme: slot.type === 'tout' ? wine.forme : slot.type,
            collection: wine.collection,
            clayette: slot.clayette,
            rang: slot.rang,
          };
        }),
      })),
    );
  });

/* ------------------------------------------------------------------ */
/* Écriture                                                            */
/* ------------------------------------------------------------------ */

describe('serializeCellar', () => {
  it("écrit l'exemple du contrat, lignes terminées par CRLF", () => {
    const cellar: Cellar = {
      shelves: [
        { capacite: 12, type: 'bordeaux' },
        { capacite: 12, type: 'tout' },
      ],
      bottles: [
        bottle({
          clayette: 2,
          rang: 1,
          chateau: 'Dom Pérignon',
          appellation: 'Champagne',
          annee: null,
          cepages: ['Chardonnay', 'Pinot noir'],
          robe: 'blanc',
          forme: 'champagne',
          collection: true,
        }),
        bottle({
          clayette: 1,
          rang: 3,
          chateau: 'Château Margaux',
          appellation: 'Margaux',
          annee: 2015,
          cepages: ['Cabernet Sauvignon', 'Merlot'],
        }),
      ],
    };
    expect(serializeCellar(cellar)).toBe(
      'enregistrement;clayette;rang;emplacements;type;chateau;appellation;annee;cepages;robe;forme;collection\r\n' +
        'clayette;1;;12;Bordeaux;;;;;;;\r\n' +
        'clayette;2;;12;Tout;;;;;;;\r\n' +
        'bouteille;1;3;;;Château Margaux;Margaux;2015;Cabernet Sauvignon, Merlot;Rouge;Bordeaux;non\r\n' +
        'bouteille;2;1;;;Dom Pérignon;Champagne;;Chardonnay, Pinot noir;Blanc;Champagne;oui\r\n',
    );
  });

  it('utilise le séparateur « ; », sans BOM, et ne modifie pas la cave', () => {
    const cellar: Cellar = { shelves: shelves(2), bottles: [bottle({ clayette: 2, rang: 5 }), bottle({ clayette: 1, rang: 1 })] };
    const copie = structuredClone(cellar);
    const text = serializeCellar(cellar);
    expect(CSV_SEPARATOR).toBe(';');
    expect(text.startsWith('enregistrement;')).toBe(true);
    expect(text.charCodeAt(0)).not.toBe(0xfeff);
    expect(cellar).toEqual(copie);
  });

  it("écrit les clayettes dans l'ordre puis les bouteilles dans l'ordre de lecture", () => {
    const cellar: Cellar = {
      shelves: [
        { capacite: 10, type: 'champagne' },
        { capacite: 14, type: 'bourgogne' },
        { capacite: 12, type: 'tout' },
      ],
      bottles: [
        bottle({ clayette: 3, rang: 2, chateau: 'C' }),
        bottle({ clayette: 1, rang: 9, chateau: 'A', forme: 'champagne' }),
        bottle({ clayette: 3, rang: 1, chateau: 'B' }),
      ],
    };
    const lines = serializeCellar(cellar).split('\r\n');
    expect(lines.map((l) => l.split(';').slice(0, 6).join(';'))).toEqual([
      'enregistrement;clayette;rang;emplacements;type;chateau',
      'clayette;1;;10;Champagne;',
      'clayette;2;;14;Bourgogne;',
      'clayette;3;;12;Tout;',
      'bouteille;1;9;;;A',
      'bouteille;3;1;;;B',
      'bouteille;3;2;;;C',
      '',
    ]);
  });

  it('écrit les libellés français des robes et des formes', () => {
    const cellar: Cellar = {
      shelves: shelves(1),
      bottles: [
        bottle({ clayette: 1, rang: 1, robe: 'blanc-liquoreux', forme: 'autre' }),
        bottle({ clayette: 1, rang: 2, robe: 'rose', forme: 'bourgogne' }),
      ],
    };
    const text = serializeCellar(cellar);
    expect(text).toContain(';Blanc liquoreux;Autre;non\r\n');
    expect(text).toContain(';Rosé;Bourgogne;non\r\n');
  });

  it('entoure de guillemets les champs qui le nécessitent et double les guillemets', () => {
    const cas: [string, string][] = [
      ['a;b', '"a;b"'],
      ['dit "Le Vieux"', '"dit ""Le Vieux"""'],
      ['ligne 1\nligne 2', '"ligne 1\nligne 2"'],
      ['retour\rchariot', '"retour\rchariot"'],
      [' espace devant', '" espace devant"'],
      ['espace derrière ', '"espace derrière "'],
      [`${NBSP}insécable`, `"${NBSP}insécable"`],
      ['virgule, sans guillemets', 'virgule, sans guillemets'],
      ["l'apostrophe", "l'apostrophe"],
      ['Château Margaux', 'Château Margaux'],
    ];
    for (const [chateau, attendu] of cas) {
      const text = serializeCellar({ shelves: shelves(1), bottles: [bottle({ clayette: 1, rang: 1, chateau })] });
      expect(text).toContain(`bouteille;1;1;;;${attendu};Margaux;2015;`);
    }
  });

  it('neutralise les formules de tableur par une apostrophe', () => {
    const cas: [string, string][] = [
      ['=1+1', "'=1+1"],
      ['+33 6 12', "'+33 6 12"],
      ['-M- Cuvée', "'-M- Cuvée"],
      ['@SOMME(A1)', "'@SOMME(A1)"],
      ['=cmd|"/c calc"!A1', '"\'=cmd|""/c calc""!A1"'],
      ['=a;b', '"\'=a;b"'],
      // Déjà précédée d'une apostrophe : une de plus, pour pouvoir relire la valeur exacte.
      ["'=1+1", "''=1+1"],
      // Formule cachée derrière des espaces : neutralisée aussi.
      [' =1+1', "' =1+1"],
      ['\t=1+1', "'\t=1+1"],
      // Pas des formules.
      ['Saint-Émilion', 'Saint-Émilion'],
      ['a=b', 'a=b'],
      ["'t Hof", "'t Hof"],
    ];
    for (const [chateau, attendu] of cas) {
      const text = serializeCellar({ shelves: shelves(1), bottles: [bottle({ clayette: 1, rang: 1, chateau })] });
      expect(text).toContain(`bouteille;1;1;;;${attendu};Margaux;2015;`);
    }
    // Les autres colonnes de texte sont neutralisées de la même façon.
    const text = serializeCellar({
      shelves: shelves(1),
      bottles: [bottle({ clayette: 1, rang: 1, appellation: '@appellation', cepages: ['=Cinsault', 'Merlot'] })],
    });
    expect(text).toContain(";'@appellation;2015;'=Cinsault, Merlot;Rouge;");
  });

  it('aucune cellule écrite ne peut être prise pour une formule', () => {
    fc.assert(
      fc.property(cellarArb, (cellar) => {
        // Telles qu'un tableur les voit, aucune valeur ne commence par = + - @ (même après des espaces).
        for (const value of rawCells(serializeCellar(cellar))) expect(value).not.toMatch(/^\s*[=+\-@]/);
      }),
      { numRuns: 5000 },
    );
  });
});

/* ------------------------------------------------------------------ */
/* Aller-retour                                                        */
/* ------------------------------------------------------------------ */

describe('aller-retour parseCellarCsv(serializeCellar(cave))', () => {
  it('le générateur de cépages respecte le format de la colonne', () => {
    for (const cepage of CEPAGES) expect(splitCepages(joinCepages([cepage, 'Viognier']))).toEqual([cepage, 'Viognier']);
  });

  it('redonne la même cave, aux identifiants près (caractères spéciaux compris)', () => {
    fc.assert(
      fc.property(cellarArb, (cellar) => {
        expect(validateCellar(cellar)).toEqual([]);
        const result = parseCellarCsv(serializeCellar(cellar));
        expect(result.errors).toEqual([]);
        expect(result.warnings).toEqual([]);
        expect(result.stats).toEqual({
          bouteilles: cellar.bottles.length,
          clayettes: cellar.shelves.length,
          lignesIgnorees: 0,
        });
        if (!result.cellar) throw new Error('cave attendue');
        expect(comparable(result.cellar)).toEqual(comparable(cellar));
        // Les bouteilles sont rendues dans l'ordre du fichier, qui est l'ordre de lecture.
        expect(result.cellar.bottles.map(sansId)).toEqual(bottlesInReadingOrder(cellar).map(sansId));
        expect(validateCellar(result.cellar)).toEqual([]);
        expect(new Set(result.cellar.bottles.map((b) => b.id)).size).toBe(cellar.bottles.length);
      }),
      { numRuns: 20000 },
    );
  });

  it('est stable : réécrire la cave relue donne le même fichier, avec ou sans BOM', () => {
    fc.assert(
      fc.property(cellarArb, fc.boolean(), (cellar, bom) => {
        const text = serializeCellar(cellar);
        const result = parseCellarCsv(bom ? `${BOM}${text}` : text);
        if (!result.cellar) throw new Error('cave attendue');
        expect(serializeCellar(result.cellar)).toBe(text);
      }),
      { numRuns: 5000 },
    );
  });

  it('conserve à l’identique des noms pleins de pièges', () => {
    const noms = TEXTES_PIEGES.filter((t) => t.trim() !== '');
    const cellar: Cellar = {
      shelves: shelves(3, 20),
      bottles: noms.map((nom, i) =>
        bottle({ clayette: Math.floor(i / 20) + 1, rang: (i % 20) + 1, chateau: nom, appellation: [...nom].reverse().join('') }),
      ),
    };
    const { cellar: relue, warnings } = read(serializeCellar(cellar));
    expect(warnings).toEqual([]);
    expect(relue.bottles.map((b) => b.chateau)).toEqual(noms);
    expect(comparable(relue)).toEqual(comparable(cellar));
  });

  it('une cave vide (clayettes seules) fait aussi l’aller-retour', () => {
    const cellar: Cellar = { shelves: [{ capacite: 1, type: 'champagne' }], bottles: [] };
    const { cellar: relue, warnings } = read(serializeCellar(cellar));
    expect(warnings).toEqual([]);
    expect(relue).toEqual(cellar);
  });
});

/* ------------------------------------------------------------------ */
/* Lecture tolérante                                                   */
/* ------------------------------------------------------------------ */

describe('parseCellarCsv — fichiers « Excel »', () => {
  const CANONIQUE = file(
    HEADER,
    'clayette;1;;12;Bordeaux;;;;;;;',
    'clayette;2;;12;Tout;;;;;;;',
    'bouteille;1;3;;;Château Margaux;Margaux;2015;Cabernet Sauvignon, Merlot;Rouge;Bordeaux;non',
    'bouteille;2;1;;;Dom Pérignon;Champagne;;Chardonnay, Pinot noir;Blanc;Champagne;oui',
  );
  const attendu = comparable(read(CANONIQUE).cellar);

  it("lit l'exemple du contrat", () => {
    const { cellar, warnings, stats } = read(CANONIQUE);
    expect(warnings).toEqual([]);
    expect(stats).toEqual({ bouteilles: 2, clayettes: 2, lignesIgnorees: 0 });
    expect(cellar.shelves).toEqual([
      { capacite: 12, type: 'bordeaux' },
      { capacite: 12, type: 'tout' },
    ]);
    expect(cellar.bottles.map(sansId)).toEqual([
      {
        chateau: 'Château Margaux',
        appellation: 'Margaux',
        annee: 2015,
        cepages: ['Cabernet Sauvignon', 'Merlot'],
        robe: 'rouge',
        forme: 'bordeaux',
        collection: false,
        clayette: 1,
        rang: 3,
      },
      {
        chateau: 'Dom Pérignon',
        appellation: 'Champagne',
        annee: null,
        cepages: ['Chardonnay', 'Pinot noir'],
        robe: 'blanc',
        forme: 'champagne',
        collection: true,
        clayette: 2,
        rang: 1,
      },
    ]);
    expect(new Set(cellar.bottles.map((b) => b.id)).size).toBe(2);
  });

  it('ignore le BOM UTF-8', () => {
    const { cellar, warnings } = read(`${BOM}${CANONIQUE}`);
    expect(warnings).toEqual([]);
    expect(comparable(cellar)).toEqual(attendu);
  });

  it('accepte les fins de ligne LF, CR, mélangées, et l’absence de fin de ligne finale', () => {
    for (const text of [
      CANONIQUE.replaceAll('\r\n', '\n'),
      CANONIQUE.replaceAll('\r\n', '\r'),
      CANONIQUE.replace('\r\n', '\n').replace('\r\n', '\r'),
      CANONIQUE.trimEnd(),
    ]) {
      const { cellar, warnings } = read(text);
      expect(warnings).toEqual([]);
      expect(comparable(cellar)).toEqual(attendu);
    }
  });

  it('ignore les lignes vides, les lignes de séparateurs seuls et les lignes #commentaire', () => {
    const { cellar, warnings, stats } = read(
      [
        '',
        '# Cave de test — exportée le 16/11/2026 ; "guillemet" orphelin',
        '   ',
        HEADER,
        '',
        'clayette;1;;12;Bordeaux;;;;;;;',
        '# commentaire au milieu',
        ';;;;;;;;;;;',
        'clayette;2;;12;Tout;;;;;;;',
        '  # commentaire indenté',
        'bouteille;1;3;;;Château Margaux;Margaux;2015;Cabernet Sauvignon, Merlot;Rouge;Bordeaux;non',
        '',
        '',
        'bouteille;2;1;;;Dom Pérignon;Champagne;;Chardonnay, Pinot noir;Blanc;Champagne;oui',
        '',
      ].join('\n'),
    );
    expect(warnings).toEqual([]);
    expect(stats.lignesIgnorees).toBe(0);
    expect(comparable(cellar)).toEqual(attendu);
  });

  it('détecte le séparateur virgule', () => {
    const { cellar, warnings } = read(
      [
        'enregistrement,clayette,rang,emplacements,type,chateau,appellation,annee,cepages,robe,forme,collection',
        'clayette,1,,12,Bordeaux,,,,,,,',
        'clayette,2,,12,Tout,,,,,,,',
        'bouteille,1,3,,,Château Margaux,Margaux,2015,"Cabernet Sauvignon, Merlot",Rouge,Bordeaux,non',
        'bouteille,2,1,,,Dom Pérignon,Champagne,,"Chardonnay, Pinot noir",Blanc,Champagne,oui',
      ].join('\n'),
    );
    expect(warnings).toEqual([]);
    expect(comparable(cellar)).toEqual(attendu);
  });

  it('détecte le séparateur tabulation (cellules copiées depuis un tableur)', () => {
    const { cellar, warnings } = read(CANONIQUE.replaceAll(';', '\t'));
    expect(warnings).toEqual([]);
    expect(comparable(cellar)).toEqual(attendu);
  });

  it('choisit le séparateur qui fait reconnaître le plus de colonnes', () => {
    // L'en-tête contient plus de virgules que de points-virgules, mais c'est bien un fichier « ; ».
    const { cellar } = read('Nom (domaine, château, etc.);Château;Appellation\nignoré;Château Margaux;Margaux\n');
    expect(cellar.bottles.map((b) => [b.chateau, b.appellation])).toEqual([['Château Margaux', 'Margaux']]);
  });

  it('accepte l’indication « sep= » d’Excel en première ligne', () => {
    const { cellar, warnings } = read(`sep=;\r\n${CANONIQUE}`);
    expect(warnings).toEqual([]);
    expect(comparable(cellar)).toEqual(attendu);
    expect(comparable(read(`sep=|\n${CANONIQUE.replaceAll(';', '|')}`).cellar)).toEqual(attendu);
  });

  it('reconnaît les en-têtes accentués, en majuscules et leurs alias, dans le désordre', () => {
    const { cellar, warnings } = read(
      file(
        'COLLECTION;Forme de bouteille;Couleur;Cépage(s);Millésime;Appellation;Château;Type;Nombre d\'emplacements;Position;N° clayette;Enregistrement',
        ';;;;;;;Bordeaux;12;;1;clayette',
        ';;;;;;;Tout;12;;2;clayette',
        'non;Bordeaux;Rouge;Cabernet Sauvignon, Merlot;2015;Margaux;Château Margaux;;;3;1;bouteille',
        'oui;Champagne;Blanc;Chardonnay, Pinot noir;;Champagne;Dom Pérignon;;;1;2;bouteille',
      ),
    );
    expect(warnings).toEqual([]);
    expect(comparable(cellar)).toEqual(attendu);
  });

  it.each([
    ['chateau', ['Château', 'CHATEAU', 'Domaine', 'Producteur', 'Nom', 'Vin', 'Château / Domaine']],
    ['appellation', ['Appellation', 'AOC', 'A.O.P.']],
    ['annee', ['Année', 'ANNEE', 'Millésime', 'millesime', 'Vintage']],
    ['cepages', ['Cépages', 'Cépage', 'cépage(s)', 'Encépagement']],
    ['robe', ['Robe', 'Couleur', 'Type de vin']],
    ['forme', ['Forme', 'Forme de la bouteille']],
    ['collection', ['Collection', 'De collection']],
    ['clayette', ['Clayette', 'N° clayette', 'n°clayette', 'Numéro de clayette', 'Étagère', 'No étagère']],
    ['rang', ['Rang', 'N° rang', 'Position', 'Colonne']],
  ])('alias de la colonne « %s »', (colonne, alias) => {
    const valeurs: Record<string, string> = {
      chateau: 'Château Margaux',
      appellation: 'Margaux',
      annee: '2015',
      cepages: 'Cabernet Sauvignon, Merlot',
      robe: 'Rouge',
      forme: 'Bordeaux',
      collection: 'non',
      clayette: '1',
      rang: '3',
    };
    const noms = Object.keys(valeurs);
    for (const nom of alias) {
      const text = file(
        noms.map((n) => (n === colonne ? nom : n)).join(';'),
        noms.map((n) => valeurs[n]).join(';'),
      );
      const { cellar, warnings } = read(text);
      expect(warnings).toEqual([expect.stringContaining('Aucune ligne « clayette »')]);
      expect(cellar.bottles.map(sansId)).toEqual([attendu.bottles[0]]);
    }
  });

  it('ignore les colonnes inconnues en le signalant', () => {
    const { cellar, warnings } = read(
      file(
        'Prix;enregistrement;clayette;rang;emplacements;type;chateau;Note / 20;appellation;annee;cepages;robe;forme;collection;Commentaire',
        ';clayette;1;;12;Bordeaux;;;;;;;;;',
        ';clayette;2;;12;Tout;;;;;;;;;',
        '450 €;bouteille;1;3;;;Château Margaux;19;Margaux;2015;Cabernet Sauvignon, Merlot;Rouge;Bordeaux;non;à garder',
        ';bouteille;2;1;;;Dom Pérignon;;Champagne;;Chardonnay, Pinot noir;Blanc;Champagne;oui;',
      ),
    );
    expect(warnings).toEqual(['Colonnes non reconnues, ignorées : « Prix », « Note / 20 », « Commentaire ».']);
    expect(comparable(cellar)).toEqual(attendu);
    expect(read('chateau;prix\nMargaux;12\n').warnings).toContain('Colonne non reconnue, ignorée : « prix ».');
  });

  it('retire les espaces autour des valeurs et des en-têtes', () => {
    const { cellar, warnings } = read(
      file(
        ' enregistrement ; clayette ;rang ; emplacements;  type  ;chateau ; appellation;annee ;cepages; robe ;forme ; collection ',
        ' clayette ; 1 ; ; 12 ; Bordeaux ;;;;;;;',
        'clayette;2;;12 ;Tout;;;;;;;',
        '  bouteille ; 1 ;  3 ;;;  Château Margaux  ; Margaux ; 2015 ;  Cabernet Sauvignon ,  Merlot ;  Rouge ; Bordeaux ; non ',
        'bouteille;2;1;;;\tDom Pérignon\t;Champagne ;;Chardonnay,Pinot noir; Blanc;Champagne ;  oui',
      ),
    );
    expect(warnings).toEqual([]);
    expect(comparable(cellar)).toEqual(attendu);
  });

  it('garde tel quel le contenu des champs entre guillemets', () => {
    const { cellar, warnings } = read(
      file(
        'chateau;appellation;clayette;rang',
        '"Château; ""Le Vieux""";"  Pomerol  ";1;1',
        '"Clos',
        'sur deux lignes" ; "Mâcon" ;1;2',
        'Un "guillemet" au milieu;Bordeaux;1;3',
      ),
    );
    expect(matching(warnings, 'Ligne')).toEqual([]);
    expect(cellar.bottles.map((b) => [b.chateau, b.appellation])).toEqual([
      ['Château; "Le Vieux"', '  Pomerol  '],
      ['Clos\r\nsur deux lignes', 'Mâcon'],
      ['Un "guillemet" au milieu', 'Bordeaux'],
    ]);
  });

  it("retire l'apostrophe de neutralisation des formules", () => {
    const { cellar } = read(
      file(
        'chateau;appellation;clayette;rang',
        "'=1+1;'@appellation;1;1",
        "'-M- Cuvée;'+33;1;2",
        '"\'=a;b";x;1;3',
        "''=1+1;x;1;4",
        "'t Hof;L'Étoile;1;5",
      ),
    );
    expect(cellar.bottles.map((b) => [b.chateau, b.appellation])).toEqual([
      ['=1+1', '@appellation'],
      ['-M- Cuvée', '+33'],
      ['=a;b', 'x'],
      ["'=1+1", 'x'],
      ["'t Hof", "L'Étoile"],
    ]);
  });

  it('se passe de la colonne « enregistrement » : une ligne nommée est une bouteille', () => {
    const { cellar, warnings, stats } = read(
      file(
        'clayette;rang;emplacements;type;chateau;appellation;annee;robe;forme',
        '1;;10;Champagne;;;;;',
        '2;;14;Bordeaux;;;;;',
        '2;4;;;Château Margaux;;2015;Rouge;Bordeaux',
        '1;1;;;;Champagne;;Blanc;Champagne',
        ';;;;;;2012;Rouge;',
      ),
    );
    expect(cellar.shelves).toEqual([
      { capacite: 10, type: 'champagne' },
      { capacite: 14, type: 'bordeaux' },
    ]);
    expect(cellar.bottles.map((b) => [b.chateau, b.appellation, b.clayette, b.rang])).toEqual([
      ['Château Margaux', '', 2, 4],
      ['', 'Champagne', 1, 1],
    ]);
    expect(warnings).toEqual(['Ligne 6 : ni château ni appellation — ligne ignorée.']);
    expect(stats).toEqual({ bouteilles: 2, clayettes: 2, lignesIgnorees: 1 });
  });

  it('avec la colonne « enregistrement » : valeur vide déduite, valeur inconnue ou bouteille sans nom ignorée', () => {
    const { cellar, warnings, stats } = read(
      file(
        HEADER,
        'Clayette;1;;12;Tout;;;;;;;',
        ';2;;8;Bordeaux;;;;;;;',
        'BOUTEILLE;1;1;;;Château A;;2015;;Rouge;Bordeaux;non',
        ';1;2;;;Château B;;2016;;Rouge;Bordeaux;non',
        'Vin;1;3;;;Château C;;2017;;Rouge;Bordeaux;non',
        'caisse;1;4;;;Château D;;2018;;Rouge;Bordeaux;non',
        'bouteille;1;5;;;;;2019;;Rouge;Bordeaux;non',
      ),
    );
    expect(cellar.shelves).toEqual([
      { capacite: 12, type: 'tout' },
      { capacite: 8, type: 'bordeaux' },
    ]);
    expect(cellar.bottles.map((b) => b.chateau)).toEqual(['Château A', 'Château B', 'Château C']);
    expect(warnings).toEqual([
      'Ligne 7 : enregistrement « caisse » inconnu (attendu : « clayette » ou « bouteille ») — ligne ignorée.',
      'Ligne 8 : bouteille sans château ni appellation — ligne ignorée.',
    ]);
    expect(stats.lignesIgnorees).toBe(2);
  });

  it('interprète souplement robe, forme, type et collection', () => {
    const { cellar, warnings } = read(
      file(
        HEADER,
        'clayette;1;;20;TOUTES FORMES;;;;;;;',
        'clayette;2;;5;bordelaise;;;;;;;',
        'clayette;3;;5;Bourguignonne;;;;;;;',
        'clayette;4;;5;champenoise;;;;;;;',
        'bouteille;1;1;;;A;;;;rouge;bordelaise;OUI',
        'bouteille;1;2;;;B;;;;BLANC;Bourguignonne;o',
        'bouteille;1;3;;;C;;;;Rosé;champenoise;true',
        'bouteille;1;4;;;D;;;;rose;flûte;1',
        'bouteille;1;5;;;E;;;;Blanc liquoreux;Bdx;x',
        'bouteille;1;6;;;F;;;;moelleux;autre;Vrai',
        'bouteille;1;7;;;G;;;;Red;Magnum;yes',
        'bouteille;1;8;;;H;;;;effervescent;Champagne;Non',
        'bouteille;1;9;;;I;;;;Rouge;Bordeaux;n',
        'bouteille;1;10;;;J;;;;Rouge;Bordeaux;FALSE',
        'bouteille;1;11;;;K;;;;Rouge;Bordeaux;0',
        'bouteille;1;12;;;L;;;;Rouge;Bordeaux;faux',
        'bouteille;1;13;;;M;;;;Rouge;Bordeaux;',
      ),
    );
    expect(warnings).toEqual([]);
    expect(cellar.shelves.map((s) => s.type)).toEqual(['tout', 'bordeaux', 'bourgogne', 'champagne']);
    expect(cellar.bottles.map((b) => `${b.chateau}:${b.robe}:${b.forme}:${b.collection ? 'C' : '-'}`)).toEqual([
      'A:rouge:bordeaux:C',
      'B:blanc:bourgogne:C',
      'C:rose:champagne:C',
      'D:rose:autre:C',
      'E:blanc-liquoreux:bordeaux:C',
      'F:blanc-liquoreux:autre:C',
      'G:rouge:autre:C',
      'H:blanc:champagne:-',
      'I:rouge:bordeaux:-',
      'J:rouge:bordeaux:-',
      'K:rouge:bordeaux:-',
      'L:rouge:bordeaux:-',
      'M:rouge:bordeaux:-',
    ]);
  });

  it('signale une valeur de « collection » incomprise', () => {
    const { cellar, warnings } = read(file(HEADER, 'clayette;1;;12;Tout;;;;;;;', 'bouteille;1;1;;;A;;2015;;Rouge;Bordeaux;peut-être'));
    expect(cellar.bottles[0]?.collection).toBe(false);
    expect(warnings).toEqual([
      'Ligne 3 : valeur « peut-être » non comprise dans la colonne « collection » (attendu : oui ou non) — A 2015 n\'est pas marquée « collection ».',
    ]);
  });

  it('ne prend pas « hors collection » pour un oui', () => {
    const { cellar, warnings } = read(
      file(
        'chateau;collection',
        'A;Collection',
        'B;✓',
        'C;-',
        'D;hors collection',
      ),
    );
    expect(cellar.bottles.map((b) => b.collection)).toEqual([true, true, false, false]);
    expect(matching(warnings, 'Ligne')).toEqual([
      'Ligne 5 : valeur « hors collection » non comprise dans la colonne « collection » (attendu : oui ou non) — D n\'est pas marquée « collection ».',
    ]);
  });

  it('découpe les cépages comme le formulaire', () => {
    const { cellar } = read(
      file(
        'chateau;cepages',
        'A;Merlot, Cabernet franc',
        'B;"Syrah; Grenache / Mourvèdre"',
        'C;Chardonnay et Aligoté',
        'D;',
        'E;Merlot, merlot , MERLOT',
      ),
    );
    expect(cellar.bottles.map((b) => b.cepages)).toEqual([
      ['Merlot', 'Cabernet franc'],
      ['Syrah', 'Grenache', 'Mourvèdre'],
      ['Chardonnay', 'Aligoté'],
      [],
      ['Merlot'],
    ]);
  });

  it('signale les valeurs en trop sur une ligne', () => {
    const { cellar, warnings } = read(file('chateau;appellation', 'A;Margaux;;;', 'B;Pauillac;surprise;;'));
    expect(cellar.bottles).toHaveLength(2);
    expect(matching(warnings, 'Ligne')).toEqual([
      'Ligne 3 : 5 valeurs pour 2 colonnes — les valeurs en trop sont ignorées (un séparateur dans une valeur sans guillemets ?).',
    ]);
  });

  it('utilise la première valeur non vide quand deux colonnes ont le même rôle', () => {
    const { cellar, warnings } = read(file('Nom;Domaine;Appellation', 'Cuvée A;Domaine A;Margaux', ';Domaine B;Pauillac'));
    expect(cellar.bottles.map((b) => b.chateau)).toEqual(['Cuvée A', 'Domaine B']);
    expect(warnings).toContain(
      'Les colonnes « Nom », « Domaine » désignent toutes « chateau » : pour chaque ligne, la première valeur non vide est utilisée.',
    );
  });

  it('signale un guillemet jamais refermé', () => {
    const result = parseCellarCsv(file('chateau;appellation', 'A;Margaux', '"B;Pauillac', 'C;Pomerol'));
    expectCoherent(result);
    expect(matching(result.warnings, 'Ligne 3', 'guillemet ouvert jamais refermé')).toHaveLength(1);
    expect(result.cellar?.bottles.map((b) => b.chateau)).toEqual(['A', 'B;Pauillac\r\nC;Pomerol\r\n']);
  });
});

/* ------------------------------------------------------------------ */
/* Années                                                              */
/* ------------------------------------------------------------------ */

describe('parseCellarCsv — années', () => {
  const lire = (annee: string) => read(file('chateau;annee', `Château Test;${annee}`));

  it.each([
    ['2015', 2015],
    ['2015.0', 2015],
    ['2015,0', 2015],
    ['2015.00', 2015],
    [' 1985 ', 1985],
    ['1800', 1800],
    [String(ANNEE_MAX), ANNEE_MAX],
    ['', null],
    ['NM', null],
    ['nm', null],
    ['NV', null],
    ['sans', null],
    ['Sans', null],
    ['Sans millésime', null],
    ['non millésimé', null],
    ['-', null],
  ])('« %s » est acceptée sans avertissement', (texte, attendue) => {
    const { cellar, warnings } = lire(texte);
    expect(cellar.bottles[0]?.annee).toBe(attendue);
    expect(matching(warnings, 'année')).toEqual([]);
  });

  it.each(['abc', '15', '2015.5', '20015', '1799', String(ANNEE_MAX + 1), '2015-2016', 'vers 2010', '0'])(
    '« %s » est invalide : pas de millésime, avec avertissement',
    (texte) => {
      const { cellar, warnings } = lire(texte);
      expect(cellar.bottles[0]?.annee).toBeNull();
      expect(matching(warnings, 'année')).toEqual([
        `Ligne 2 : année « ${texte} » invalide — Château Test est enregistrée sans millésime.`,
      ]);
    },
  );
});

/* ------------------------------------------------------------------ */
/* Configuration des clayettes                                         */
/* ------------------------------------------------------------------ */

describe('parseCellarCsv — configuration', () => {
  it('sans ligne clayette : cave par défaut déduite, avec avertissement', () => {
    const { cellar, warnings } = read(
      file(HEADER, 'bouteille;3;4;;;Château A;Margaux;2015;;Rouge;Bordeaux;non', 'bouteille;1;1;;;Château B;Margaux;2016;;Rouge;Bordeaux;non'),
    );
    expect(cellar.shelves).toEqual(shelves(SHELF_LIMITS.defaultShelves, SHELF_LIMITS.defaultCapacity, 'tout'));
    expect(cellar.bottles.map((b) => [b.clayette, b.rang])).toEqual([
      [3, 4],
      [1, 1],
    ]);
    expect(warnings).toEqual([
      'Aucune ligne « clayette » dans le fichier : configuration déduite des bouteilles (12 clayettes de 12 emplacements, type « Tout »).',
    ]);
  });

  it('sans ligne clayette : la cave s’agrandit jusqu’au plus grand n° de clayette et de rang rencontré', () => {
    const { cellar, warnings } = read(
      file(HEADER, 'bouteille;15;2;;;Château A;;2015;;Rouge;Bordeaux;non', 'bouteille;2;17;;;Château B;;2016;;Blanc;Autre;non'),
    );
    expect(cellar.shelves).toEqual(shelves(15, 17, 'tout'));
    expect(cellar.bottles.map((b) => [b.clayette, b.rang])).toEqual([
      [15, 2],
      [2, 17],
    ]);
    expect(warnings).toEqual([
      'Aucune ligne « clayette » dans le fichier : configuration déduite des bouteilles (15 clayettes de 17 emplacements, type « Tout »).',
    ]);
  });

  it('sans ligne clayette : la configuration déduite est bornée par SHELF_LIMITS', () => {
    const { cellar, warnings } = read(
      file(HEADER, 'bouteille;42;2;;;Château A;;2015;;Rouge;Bordeaux;non', 'bouteille;2;25;;;Château B;;2016;;Rouge;Bordeaux;non'),
    );
    expect(cellar.shelves).toEqual(shelves(SHELF_LIMITS.maxShelves, SHELF_LIMITS.maxCapacity, 'tout'));
    expect(cellar.bottles.map((b) => [b.chateau, b.clayette, b.rang])).toEqual([
      ['Château A', 1, 1],
      ['Château B', 1, 2],
    ]);
    expect(warnings).toEqual([
      'Aucune ligne « clayette » dans le fichier : configuration déduite des bouteilles (30 clayettes de 20 emplacements, type « Tout »).',
      'Le fichier mentionne la clayette n° 42, mais une cave est limitée à 30 clayettes : les bouteilles au-delà sont replacées.',
      'Le fichier mentionne le rang n° 25, mais une clayette est limitée à 20 emplacements : les bouteilles au-delà sont replacées.',
      "Ligne 2 : Château A 2015 — l'emplacement clayette 42, rang 2 n'existe pas dans la cave ; bouteille replacée en clayette 1, rang 1.",
      "Ligne 3 : Château B 2016 — l'emplacement clayette 2, rang 25 n'existe pas dans la cave ; bouteille replacée en clayette 1, rang 2.",
    ]);
  });

  it('borne le nombre d’emplacements d’une clayette, avec avertissement', () => {
    const { cellar, warnings } = read(
      file(
        HEADER,
        'clayette;1;;25;Bordeaux;;;;;;;',
        'clayette;2;;0;Tout;;;;;;;',
        'clayette;3;;;Tout;;;;;;;',
        'clayette;4;;douze;Tout;;;;;;;',
        'clayette;5;;20;Tout;;;;;;;',
        'clayette;6;;1;Tout;;;;;;;',
        'clayette;7;;12.0;Tout;;;;;;;',
      ),
    );
    expect(cellar.shelves.map((s) => s.capacite)).toEqual([20, 1, 12, 12, 20, 1, 12]);
    expect(warnings).toEqual([
      'Ligne 2 : clayette 1 — 25 emplacements demandés, maximum 20 : valeur ramenée à 20.',
      'Ligne 3 : clayette 2 — 0 emplacement demandé, minimum 1 : valeur ramenée à 1.',
      "Ligne 4 : clayette 3 — nombre d'emplacements absent : 12 par défaut.",
      "Ligne 5 : clayette 4 — nombre d'emplacements « douze » illisible : 12 par défaut.",
    ]);
  });

  it('ignore les clayettes au-delà de la limite et replace leurs bouteilles', () => {
    const lignes = Array.from({ length: 32 }, (_, i) => `clayette;${i + 1};;2;Tout;;;;;;;`);
    const { cellar, warnings, stats } = read(file(HEADER, ...lignes, 'bouteille;32;1;;;Château A;;2015;;Rouge;Bordeaux;non'));
    expect(cellar.shelves).toHaveLength(SHELF_LIMITS.maxShelves);
    expect(cellar.bottles.map((b) => [b.clayette, b.rang])).toEqual([[1, 1]]);
    expect(warnings).toEqual([
      'Ligne 32 : clayette n° 31 au-delà de la limite de 30 clayettes — ligne ignorée.',
      'Ligne 33 : clayette n° 32 au-delà de la limite de 30 clayettes — ligne ignorée.',
      "Ligne 34 : Château A 2015 — l'emplacement clayette 32, rang 1 n'existe pas dans la cave ; bouteille replacée en clayette 1, rang 1.",
    ]);
    expect(stats.lignesIgnorees).toBe(2);
  });

  it('type de clayette absent ou incompris : « Tout »', () => {
    const { cellar, warnings } = read(file(HEADER, 'clayette;1;;12;;;;;;;;', 'clayette;2;;12;Magique;;;;;;;'));
    expect(cellar.shelves.map((s) => s.type)).toEqual(['tout', 'tout']);
    expect(warnings).toEqual(['Ligne 3 : clayette 2 — type « Magique » non reconnu : « Tout » par défaut.']);
  });

  it('clayettes dans le désordre, manquantes, en double, sans numéro ou au numéro illisible', () => {
    const { cellar, warnings, stats } = read(
      file(
        HEADER,
        'clayette;4;;10;Champagne;;;;;;;',
        'clayette;1;;11;Bordeaux;;;;;;;',
        'clayette;4;;14;Tout;;;;;;;',
        'clayette;;;13;Bourgogne;;;;;;;',
        'clayette;zéro;;12;Tout;;;;;;;',
        'clayette;0;;12;Tout;;;;;;;',
      ),
    );
    expect(cellar.shelves).toEqual([
      { capacite: 11, type: 'bordeaux' },
      { capacite: 12, type: 'tout' },
      { capacite: 12, type: 'tout' },
      { capacite: 10, type: 'champagne' },
      { capacite: 13, type: 'bourgogne' },
    ]);
    expect(warnings).toEqual([
      'Clayette 2 non décrite dans le fichier : 12 emplacements « Tout » par défaut.',
      'Clayette 3 non décrite dans le fichier : 12 emplacements « Tout » par défaut.',
      'Ligne 4 : la clayette n° 4 est déjà décrite ligne 2 — ligne ignorée.',
      "Ligne 5 : n° de clayette absent — clayette numérotée 5 d'après l'ordre du fichier.",
      'Ligne 6 : n° de clayette « zéro » illisible — ligne ignorée.',
      'Ligne 7 : n° de clayette « 0 » illisible — ligne ignorée.',
    ]);
    expect(stats).toEqual({ bouteilles: 0, clayettes: 5, lignesIgnorees: 3 });
  });

  it('les lignes clayette peuvent suivre les bouteilles', () => {
    const { cellar, warnings } = read(
      file(HEADER, 'bouteille;2;3;;;Krug;Champagne;;;Blanc;Champagne;non', 'clayette;1;;6;Bordeaux;;;;;;;', 'clayette;2;;6;Champagne;;;;;;;'),
    );
    expect(warnings).toEqual([]);
    expect(cellar.bottles.map((b) => [b.clayette, b.rang])).toEqual([[2, 3]]);
  });
});

/* ------------------------------------------------------------------ */
/* Placement des bouteilles                                            */
/* ------------------------------------------------------------------ */

describe('parseCellarCsv — bouteilles mal placées', () => {
  const CAVE = [HEADER, 'clayette;1;;3;Bordeaux;;;;;;;', 'clayette;2;;3;Champagne;;;;;;;', 'clayette;3;;4;Tout;;;;;;;'];

  it('doublon d’emplacement : la première garde la place, la seconde est replacée', () => {
    const { cellar, warnings, stats } = read(
      file(
        ...CAVE,
        'bouteille;1;2;;;Château A;;2015;;Rouge;Bordeaux;non',
        'bouteille;1;2;;;Château B;;2010;;Rouge;Bordeaux;non',
        'bouteille;1;2;;;Château C;;;;Rouge;Bordeaux;non',
        'bouteille;1;1;;;Château D;;2018;;Rouge;Bordeaux;non',
      ),
    );
    expect(cellar.bottles.map((b) => [b.chateau, b.clayette, b.rang])).toEqual([
      ['Château A', 1, 2],
      ['Château B', 1, 3],
      ['Château C', 3, 1],
      ['Château D', 1, 1],
    ]);
    expect(warnings).toEqual([
      "Ligne 6 : Château B 2010 — l'emplacement clayette 1, rang 2 est déjà occupé par Château A 2015 (ligne 5) ; bouteille replacée en clayette 1, rang 3.",
      "Ligne 7 : Château C — l'emplacement clayette 1, rang 2 est déjà occupé par Château A 2015 (ligne 5) ; bouteille replacée en clayette 3, rang 1.",
    ]);
    expect(stats.lignesIgnorees).toBe(0);
  });

  it('bouteille hors cave : replacée sur le premier emplacement libre compatible', () => {
    const { cellar, warnings } = read(
      file(
        ...CAVE,
        'bouteille;9;1;;;Château A;;2015;;Rouge;Bordeaux;non',
        'bouteille;1;4;;;Château B;;2016;;Rouge;Bordeaux;non',
        'bouteille;3;5;;;Riesling;Alsace;2019;;Blanc;Autre;non',
      ),
    );
    expect(cellar.bottles.map((b) => [b.chateau, b.clayette, b.rang])).toEqual([
      ['Château A', 1, 1],
      ['Château B', 1, 2],
      ['Riesling', 3, 1],
    ]);
    expect(warnings).toEqual([
      "Ligne 5 : Château A 2015 — l'emplacement clayette 9, rang 1 n'existe pas dans la cave ; bouteille replacée en clayette 1, rang 1.",
      "Ligne 6 : Château B 2016 — l'emplacement clayette 1, rang 4 n'existe pas dans la cave ; bouteille replacée en clayette 1, rang 2.",
      "Ligne 7 : Riesling 2019 — l'emplacement clayette 3, rang 5 n'existe pas dans la cave ; bouteille replacée en clayette 3, rang 1.",
    ]);
  });

  it('forme incompatible avec la clayette : replacée sur une clayette compatible', () => {
    const { cellar, warnings } = read(
      file(
        ...CAVE,
        'bouteille;1;1;;;Bollinger;Champagne;;;Blanc;Champagne;non',
        'bouteille;2;1;;;Château A;Pauillac;2015;;Rouge;Bordeaux;non',
        'bouteille;1;2;;;Trimbach;Alsace;2019;;Blanc;Autre;non',
        'bouteille;2;2;;;Domaine B;Volnay;2017;;Rouge;Bourgogne;non',
      ),
    );
    expect(cellar.bottles.map((b) => [b.chateau, b.clayette, b.rang])).toEqual([
      ['Bollinger', 2, 1],
      ['Château A', 1, 1],
      ['Trimbach', 3, 1],
      ['Domaine B', 3, 2],
    ]);
    expect(warnings).toEqual([
      'Ligne 5 : Bollinger — forme Champagne incompatible avec la clayette 1 (emplacements Bordeaux) ; bouteille replacée en clayette 2, rang 1.',
      'Ligne 6 : Château A 2015 — forme Bordeaux incompatible avec la clayette 2 (emplacements Champagne) ; bouteille replacée en clayette 1, rang 1.',
      'Ligne 7 : Trimbach 2019 — forme Autre incompatible avec la clayette 1 (emplacements Bordeaux) ; bouteille replacée en clayette 3, rang 1.',
      'Ligne 8 : Domaine B 2017 — forme Bourgogne incompatible avec la clayette 2 (emplacements Champagne) ; bouteille replacée en clayette 3, rang 2.',
    ]);
  });

  it('bouteille sans position ou à la position illisible : replacée sans voler la place des suivantes', () => {
    const { cellar, warnings } = read(
      file(
        ...CAVE,
        'bouteille;;;;;Château A;;2015;;Rouge;Bordeaux;non',
        'bouteille;1;;;;Château B;;2016;;Rouge;Bordeaux;non',
        'bouteille;un;deux;;;Château C;;2017;;Rouge;Bordeaux;non',
        'bouteille;0;1;;;Château D;;2018;;Rouge;Bordeaux;non',
        'bouteille;1;1;;;Château E;;2019;;Rouge;Bordeaux;non',
        'bouteille;1.0;2,0;;;Château F;;2020;;Rouge;Bordeaux;non',
      ),
    );
    expect(cellar.bottles.map((b) => [b.chateau, b.clayette, b.rang])).toEqual([
      ['Château A', 1, 3],
      ['Château B', 3, 1],
      ['Château C', 3, 2],
      ['Château D', 3, 3],
      ['Château E', 1, 1],
      ['Château F', 1, 2],
    ]);
    expect(warnings).toEqual([
      'Ligne 5 : Château A 2015 — position absente ; bouteille replacée en clayette 1, rang 3.',
      'Ligne 6 : Château B 2016 — position incomplète ou illisible (clayette « 1 », rang absent) ; bouteille replacée en clayette 3, rang 1.',
      'Ligne 7 : Château C 2017 — position incomplète ou illisible (clayette « un », rang « deux ») ; bouteille replacée en clayette 3, rang 2.',
      'Ligne 8 : Château D 2018 — position incomplète ou illisible (clayette « 0 », rang « 1 ») ; bouteille replacée en clayette 3, rang 3.',
    ]);
  });

  it('plus aucun emplacement compatible : la bouteille est ignorée, avec avertissement', () => {
    const { cellar, warnings, stats } = read(
      file(
        HEADER,
        'clayette;1;;1;Bordeaux;;;;;;;',
        'clayette;2;;1;Champagne;;;;;;;',
        'bouteille;1;1;;;Château A;;2015;;Rouge;Bordeaux;non',
        'bouteille;1;1;;;Château B;;2016;;Rouge;Bordeaux;non',
        'bouteille;2;1;;;Trimbach;Alsace;2019;;Blanc;Autre;non',
      ),
    );
    expect(cellar.bottles.map((b) => b.chateau)).toEqual(['Château A']);
    expect(warnings).toEqual([
      "Ligne 5 : Château B 2016 — l'emplacement clayette 1, rang 1 est déjà occupé par Château A 2015 (ligne 4) ; aucun emplacement libre compatible avec une bouteille de forme Bordeaux : bouteille ignorée.",
      'Ligne 6 : Trimbach 2019 — forme Autre incompatible avec la clayette 2 (emplacements Champagne) ; aucun emplacement libre compatible avec une bouteille de forme Autre : bouteille ignorée.',
    ]);
    expect(stats).toEqual({ bouteilles: 1, clayettes: 2, lignesIgnorees: 2 });
  });

  it('forme absente ou incomprise : déduite de la clayette spécialisée, sinon « bordeaux »', () => {
    const { cellar, warnings } = read(
      file(
        ...CAVE,
        'bouteille;2;1;;;Bollinger;Champagne;;;Blanc;;non',
        'bouteille;3;1;;;Château A;;2015;;Rouge;;non',
        'bouteille;1;1;;;Château B;;2016;;Rouge;carafe;non',
        'bouteille;;;;;Château C;;2017;;Rouge;;non',
      ),
    );
    expect(cellar.bottles.map((b) => [b.chateau, b.forme, b.clayette, b.rang])).toEqual([
      ['Bollinger', 'champagne', 2, 1],
      ['Château A', 'bordeaux', 3, 1],
      ['Château B', 'bordeaux', 1, 1],
      ['Château C', 'bordeaux', 1, 2],
    ]);
    expect(warnings).toEqual([
      "Ligne 5 : forme absente — Bollinger : « Champagne » d'après le type de la clayette 2.",
      'Ligne 6 : forme absente — Château A 2015 : « Bordeaux » par défaut.',
      "Ligne 7 : forme « carafe » non reconnue — Château B 2016 : « Bordeaux » d'après le type de la clayette 1.",
      'Ligne 8 : forme absente — Château C 2017 : « Bordeaux » par défaut.',
      'Ligne 8 : Château C 2017 — position absente ; bouteille replacée en clayette 1, rang 2.',
    ]);
  });

  it('robe absente ou incomprise : « rouge », avec avertissement', () => {
    const { cellar, warnings } = read(
      file(...CAVE, 'bouteille;1;1;;;Château A;;2015;;;Bordeaux;non', 'bouteille;1;2;;;Château B;;2016;;orange;Bordeaux;non'),
    );
    expect(cellar.bottles.map((b) => b.robe)).toEqual(['rouge', 'rouge']);
    expect(warnings).toEqual([
      'Ligne 5 : robe absente — Château A 2015 est enregistrée en « Rouge ».',
      'Ligne 6 : robe « orange » non reconnue — Château B 2016 est enregistrée en « Rouge ».',
    ]);
  });

  it('liste de vins sans position, robe ni forme : un seul avertissement par colonne absente', () => {
    const lignes = Array.from({ length: 30 }, (_, i) => `Château ${i + 1};Margaux;${1990 + i}`);
    const { cellar, warnings, stats } = read(file('Château;Appellation;Millésime', ...lignes));
    expect(warnings).toEqual([
      'Aucune ligne « clayette » dans le fichier : configuration déduite des bouteilles (12 clayettes de 12 emplacements, type « Tout »).',
      "Colonnes « clayette » et « rang » absentes : les bouteilles sont rangées dans l'ordre du fichier, sur les premiers emplacements libres compatibles.",
      'Colonne « robe » absente : toutes les bouteilles sont enregistrées en « Rouge ».',
      'Colonne « forme » absente : forme déduite du type de la clayette si elle est spécialisée, sinon « Bordeaux ».',
    ]);
    expect(stats).toEqual({ bouteilles: 30, clayettes: 12, lignesIgnorees: 0 });
    expect(cellar.bottles.map((b) => [b.clayette, b.rang])).toEqual(
      Array.from({ length: 30 }, (_, i) => [Math.floor(i / 12) + 1, (i % 12) + 1]),
    );
    expect(cellar.bottles.every((b) => b.robe === 'rouge' && b.forme === 'bordeaux' && !b.collection)).toBe(true);
  });

  it('le n° de ligne tient compte des commentaires, des lignes vides et des champs sur plusieurs lignes', () => {
    const { warnings } = read(
      [
        '# en-tête ligne 2',
        'chateau;appellation;annee',
        '',
        '"Clos',
        'sur',
        'trois lignes";Mâcon;2020',
        '# commentaire',
        'Château A;Margaux;abc',
      ].join('\r\n'),
    );
    expect(matching(warnings, 'année')).toEqual([
      'Ligne 8 : année « abc » invalide — Château A est enregistrée sans millésime.',
    ]);
  });
});

/* ------------------------------------------------------------------ */
/* Erreurs bloquantes                                                  */
/* ------------------------------------------------------------------ */

describe('parseCellarCsv — erreurs bloquantes', () => {
  it.each([
    ['chaîne vide', ''],
    ['BOM seul', BOM],
    ['espaces et lignes vides', ' \r\n\n\t\n  '],
    ['commentaires seuls', '# rien\n# du tout\n'],
    ['séparateurs seuls', ';;;\n;;;\n'],
  ])('fichier vide (%s)', (_nom, text) => {
    const result = parseCellarCsv(text);
    expectCoherent(result);
    expect(result).toEqual({
      cellar: null,
      errors: ['Le fichier est vide.'],
      warnings: [],
      stats: { bouteilles: 0, clayettes: 0, lignesIgnorees: 0 },
    });
  });

  it.each([
    ['colonnes inconnues', 'Date;Libellé;Débit;Crédit\n01/01/2026;Achat;12,00;\n'],
    ['texte libre', 'Bonjour,\nvoici ma cave.\n'],
    ['données sans en-tête', 'bouteille;1;3;;;Château Margaux;Margaux;2015;Merlot;Rouge;Bordeaux;non\n'],
    ['clayettes sans en-tête', 'clayette;1;;12;Bordeaux;;;;;;;\nclayette;2;;12;Tout;;;;;;;\n'],
    ['positions seules', 'clayette;rang\n1;2\n'],
  ])('en-tête non reconnu (%s)', (_nom, text) => {
    const result = parseCellarCsv(text);
    expectCoherent(result);
    expect(result.cellar).toBeNull();
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/^En-tête non reconnu : la ligne 1 \(« .+ »…?\) ne nomme aucune colonne utile\. Colonnes attendues : enregistrement ; clayette ; /);
  });

  it('aucune donnée après l’en-tête', () => {
    for (const text of [HEADER, `${HEADER}\r\n`, `${BOM}${HEADER}\r\n\r\n# rien\r\n;;;;;;;;;;;\r\n`, 'chateau;appellation\n']) {
      const result = parseCellarCsv(text);
      expectCoherent(result);
      expect(result.cellar).toBeNull();
      expect(result.errors).toEqual([
        "Le fichier ne contient aucune donnée : ni clayette ni bouteille après la ligne d'en-tête.",
      ]);
    }
  });

  it('aucune ligne exploitable', () => {
    const result = parseCellarCsv(file(HEADER, 'caisse;1;1;;;Château A;;;;;;', 'bouteille;1;2;;;;;2015;;;;'));
    expectCoherent(result);
    expect(result.cellar).toBeNull();
    expect(result.errors).toEqual([
      'Le fichier ne contient aucune donnée exploitable : 2 lignes ignorées (voir les avertissements).',
    ]);
    expect(result.warnings).toHaveLength(2);
    expect(result.stats).toEqual({ bouteilles: 0, clayettes: 0, lignesIgnorees: 2 });
  });
});

/* ------------------------------------------------------------------ */
/* looksLikeCellarCsv                                                  */
/* ------------------------------------------------------------------ */

describe('looksLikeCellarCsv', () => {
  it.each([
    ['fichier écrit par l’application', serializeCellar({ shelves: shelves(2), bottles: [bottle({ clayette: 1, rang: 1 })] })],
    ['en-tête seul', HEADER],
    ['avec BOM', `${BOM}${HEADER}\r\n`],
    ['après des lignes vides et un commentaire', `\n\n# ma cave\n${HEADER}\n`],
    ['après « sep=; »', `sep=;\n${HEADER}\n`],
    ['séparateur virgule', 'chateau,appellation,annee\nMargaux,Margaux,2015\n'],
    ['séparateur tabulation', 'Château\tAppellation\tMillésime\n'],
    ['en-têtes accentués et alias', 'Domaine;Couleur;Cépage(s);N° clayette;Position'],
    ['configuration seule', 'clayette;emplacements;type\n1;12;Tout\n'],
  ])('vrai : %s', (_nom, text) => {
    expect(looksLikeCellarCsv(text)).toBe(true);
  });

  it.each([
    ['chaîne vide', ''],
    ['texte libre', 'Bonjour,\n\nVoici ma cave :\n'],
    ['mot seul', 'Nom'],
    ['une seule colonne reconnue', 'Vin;Prix;Quantité'],
    ['colonnes de position seules', 'clayette;rang;type'],
    ['ligne de bouteille sans en-tête', 'bouteille;1;3;;;Château Margaux;Margaux;2015;Merlot;Rouge;Bordeaux;non'],
    ['ligne de clayette sans en-tête', 'clayette;1;;12;Bordeaux;;;;;;;'],
    ['en-tête précédé de texte', `Voici ma cave :\n${HEADER}\n`],
    ['relevé bancaire', 'Date;Libellé;Débit;Crédit'],
  ])('faux : %s', (_nom, text) => {
    expect(looksLikeCellarCsv(text)).toBe(false);
  });

  it('tout texte accepté a un en-tête que parseCellarCsv reconnaît', () => {
    const cellule = fc.constantFrom('chateau', 'Domaine', 'Appellation', 'Année', 'clayette', 'rang', 'type', 'emplacements', 'Prix', 'Bonjour', '');
    fc.assert(
      fc.property(fc.array(cellule, { maxLength: 6 }), fc.constantFrom(';', ',', '\t'), (cells, sep) => {
        const text = `${cells.join(sep)}\n`;
        if (looksLikeCellarCsv(text)) {
          expect(parseCellarCsv(text).errors.join(' ')).not.toContain('En-tête non reconnu');
        }
      }),
    );
  });
});

/* ------------------------------------------------------------------ */
/* Robustesse                                                          */
/* ------------------------------------------------------------------ */

describe('parseCellarCsv — robustesse', () => {
  it('ne lève jamais d’erreur et reste cohérent sur un texte quelconque', () => {
    const quelconque = fc.oneof(
      fc.string({ unit: 'binary', maxLength: 200 }),
      fc.string({ unit: fc.constantFrom(...UNITES_SPECIALES, 'chateau', 'clayette', 'bouteille', '1', '12'), maxLength: 80 }),
    );
    fc.assert(
      fc.property(quelconque, (text) => {
        expectCoherent(parseCellarCsv(text));
        expect(typeof looksLikeCellarCsv(text)).toBe('boolean');
      }),
      { numRuns: 20000 },
    );
  });

  it('le résultat respecte toujours validateCellar, même pour un tableau incohérent', () => {
    const enTete = fc.constantFrom(
      ...CSV_COLUMNS,
      'Château', 'Domaine', 'Millésime', 'N° clayette', 'Position', 'Couleur', 'Cépages', 'Prix', 'Note', '',
    );
    const cellule = fc.constantFrom(
      '', '', '', 'clayette', 'bouteille', 'caisse', '1', '1', '2', '3', '5', '12', '13', '20', '21', '30', '31', '0', '-1',
      '2.0', 'abc', 'Bordeaux', 'Bourgogne', 'Champagne', 'Tout', 'Autre', 'Rouge', 'Blanc', 'rosé', 'liquoreux',
      'oui', 'non', 'x', '2015', '1999', 'NM', '3000', 'Château Margaux', 'Krug', 'Merlot, Cabernet franc',
      '"a;b"', '"multi\nligne"', '=1+1', "'=1+1", '"', '#', ' ',
    );
    const tableau = fc.record({
      sep: fc.constantFrom(';', ',', '\t'),
      eol: fc.constantFrom('\n', '\r\n', '\r'),
      header: fc.array(enTete, { minLength: 1, maxLength: 14 }),
      rows: fc.array(fc.array(cellule, { maxLength: 14 }), { maxLength: 40 }),
    });
    fc.assert(
      fc.property(tableau, ({ sep, eol, header, rows }) => {
        const text = [header, ...rows].map((cells) => cells.join(sep)).join(eol);
        const result = parseCellarCsv(text);
        expectCoherent(result);
        if (result.cellar) {
          // Ce qui a été lu se réécrit et se relit à l'identique, sans rien signaler.
          const again = parseCellarCsv(serializeCellar(result.cellar));
          expect(again.warnings).toEqual([]);
          expect(again.cellar && comparable(again.cellar)).toEqual(comparable(result.cellar));
        }
      }),
      { numRuns: 20000 },
    );
  });

  it('une cave pleine de bouteilles mal placées reste valide', () => {
    // 3 clayettes spécialisées de 4 places ; 20 bouteilles toutes déclarées au même emplacement.
    const formes: Forme[] = ['bordeaux', 'bourgogne', 'champagne', 'autre'];
    const lignes = Array.from({ length: 20 }, (_, i) => {
      const forme = formes[i % 4]!;
      return `bouteille;1;1;;;Vin ${i + 1};;2015;;Rouge;${forme};non`;
    });
    const { cellar, stats, warnings } = read(
      file(HEADER, 'clayette;1;;4;Bordeaux;;;;;;;', 'clayette;2;;4;Bourgogne;;;;;;;', 'clayette;3;;4;Champagne;;;;;;;', ...lignes),
    );
    // 4 bordeaux, 4 bourgogne, 4 champagne tiennent ; les 5es et toutes les « autre » sont ignorées.
    expect(stats).toEqual({ bouteilles: 12, clayettes: 3, lignesIgnorees: 8 });
    expect(cellar.bottles.every((b) => isCompatible(b.forme, cellar.shelves[b.clayette - 1]!.type))).toBe(true);
    expect(warnings).toHaveLength(19);
  });
});

/* ------------------------------------------------------------------ */
/* Performance                                                         */
/* ------------------------------------------------------------------ */

describe('performance', () => {
  const TYPES: TypeClayette[] = ['bordeaux', 'bourgogne', 'champagne', 'tout'];
  const grande: Cellar = {
    shelves: Array.from({ length: 30 }, (_, i) => ({ capacite: 20, type: TYPES[i % 4]! })),
    bottles: [],
  };
  grande.shelves.forEach((shelf, i) => {
    for (let r = 1; r <= shelf.capacite; r++) {
      grande.bottles.push(
        bottle({
          clayette: i + 1,
          rang: r,
          chateau: `Château "N° ${i + 1}" ; rang ${r}`,
          appellation: 'Saint-Émilion Grand Cru',
          annee: 1990 + ((i * 7 + r) % 35),
          cepages: ['Merlot', 'Cabernet franc', 'Cabernet Sauvignon'],
          forme: shelf.type === 'tout' ? 'autre' : shelf.type,
          collection: r % 9 === 0,
        }),
      );
    }
  });

  it('écrit et relit 600 bouteilles en moins de 200 ms', () => {
    expect(grande.bottles).toHaveLength(600);
    const t0 = performance.now();
    const text = serializeCellar(grande);
    const result = parseCellarCsv(text);
    const duree = performance.now() - t0;
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.cellar && comparable(result.cellar)).toEqual(comparable(grande));
    expect(duree).toBeLessThan(200);
  });

  it('replace 600 bouteilles sans position en moins de 200 ms', () => {
    const lignes = grande.bottles.map((b) => `${b.chateau.replaceAll('"', '').replaceAll(';', ',')};${b.appellation};${b.annee}`);
    const text = file('chateau;appellation;annee', ...lignes);
    const t0 = performance.now();
    const result = parseCellarCsv(text);
    const duree = performance.now() - t0;
    expectCoherent(result);
    // Configuration déduite par défaut : 12 × 12 = 144 places, le reste est ignoré.
    expect(result.stats).toEqual({ bouteilles: 144, clayettes: 12, lignesIgnorees: 456 });
    expect(duree).toBeLessThan(200);
  });
});

describe('parseCellarCsv — lignes commençant par « # »', () => {
  it('une ligne de données dont le nom commence par # n\'est pas prise pour un commentaire', () => {
    const res = parseCellarCsv('chateau;appellation;annee\n#1 Cuvée;Margaux;2015\nB;Pauillac;2010\n# vrai commentaire');
    expect(res.cellar?.bottles.map((b) => b.chateau)).toEqual(['#1 Cuvée', 'B']);
  });
});
