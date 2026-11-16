/**
 * Outils partagés par les tests de la réorganisation (générateurs fast-check,
 * constructeurs de caves, recherche exhaustive). Ce fichier n'est importé que
 * par les tests.
 */
import fc from 'fast-check';
import { isCompatible } from '../cellar';
import { FORMES, type Bottle, type Cellar, type Forme, type Robe, type Shelf, type TypeClayette } from '../types';
import { VIDE, type SlotInfo } from './model';

/* ------------------------------------------------------------------ */
/* Constructeurs                                                       */
/* ------------------------------------------------------------------ */

export interface WineSpec {
  chateau: string;
  annee: number | null;
  forme?: Forme;
  collection?: boolean;
  robe?: Robe;
}

/** Fabrique une bouteille de test (identifiant fourni). */
export function makeBottle(id: string, wine: WineSpec, clayette: number, rang: number): Bottle {
  return {
    id,
    chateau: wine.chateau,
    appellation: 'Test',
    annee: wine.annee,
    cepages: [],
    robe: wine.robe ?? 'rouge',
    forme: wine.forme ?? 'bordeaux',
    collection: wine.collection ?? false,
    clayette,
    rang,
  };
}

/**
 * Construit une cave à partir d'un plan lisible : une ligne par clayette, un
 * élément par emplacement (`null` = libre). Les identifiants sont `b1`, `b2`…
 * dans l'ordre de lecture.
 */
export function cellarFromRows(rows: { type: TypeClayette; slots: (WineSpec | null)[] }[]): Cellar {
  const bottles: Bottle[] = [];
  rows.forEach((row, i) => {
    row.slots.forEach((wine, r) => {
      if (wine) bottles.push(makeBottle(`b${bottles.length + 1}`, wine, i + 1, r + 1));
    });
  });
  return { shelves: rows.map((row) => ({ capacite: row.slots.length, type: row.type })), bottles };
}

/** Raccourci : `w('Margaux', 2015)`. */
export function w(chateau: string, annee: number | null, forme: Forme = 'bordeaux', collection = false): WineSpec {
  return { chateau, annee, forme, collection };
}

/**
 * Vue lisible d'une cave : par clayette, « Château année » (ou `·` si libre).
 * Pratique pour écrire le résultat attendu d'un scénario.
 */
export function layout(cellar: Cellar): string[] {
  return cellar.shelves.map((shelf, i) => {
    const cells: string[] = [];
    for (let r = 1; r <= shelf.capacite; r++) {
      const b = cellar.bottles.find((x) => x.clayette === i + 1 && x.rang === r);
      cells.push(b ? `${b.chateau}${b.annee === null ? '' : ` ${b.annee}`}` : '·');
    }
    return cells.join(' | ');
  });
}

/* ------------------------------------------------------------------ */
/* Générateurs                                                         */
/* ------------------------------------------------------------------ */

export interface CellarArbOptions {
  maxShelves?: number;
  maxCapacity?: number;
  /** Nombre maximal d'emplacements au total (les clayettes en trop sont retirées). */
  maxSlots?: number;
  /** Nombre maximal de bouteilles (les suivantes, en ordre de lecture, sont retirées). */
  maxBottles?: number;
  /** Types de clayettes tirés (répéter un type augmente sa fréquence). */
  types?: readonly TypeClayette[];
  /** Taille maximale du catalogue de vins (petit = beaucoup de bouteilles identiques). */
  maxWines?: number;
  /** Formes de bouteilles du catalogue. */
  formes?: readonly Forme[];
}

const CHATEAUX = ['Margaux', 'Latour', 'Yquem', 'Pétrus', 'Cheval Blanc'] as const;
const ANNEES = [null, 1990, 2000, 2005, 2010, 2015] as const;
const MIXED_TYPES: readonly TypeClayette[] = ['tout', 'tout', 'tout', 'bordeaux', 'bourgogne', 'champagne'];
const FILL_RATES = [0, 15, 40, 70, 90, 100] as const;

/**
 * Caves valides aléatoires : clayettes de capacités et types variés, bouteilles
 * tirées d'un petit catalogue (doublons de classe fréquents, années `null`, formes
 * variées, bouteilles de collection), taux de remplissage de 0 à 100 %.
 */
export function arbCellar(options: CellarArbOptions = {}): fc.Arbitrary<Cellar> {
  const {
    maxShelves = 6,
    maxCapacity = 8,
    maxSlots = Infinity,
    maxBottles = Infinity,
    types = MIXED_TYPES,
    maxWines = 6,
    formes = FORMES,
  } = options;
  const shelvesArb = fc.array(
    fc.record({ capacite: fc.integer({ min: 1, max: maxCapacity }), type: fc.constantFrom(...types) }),
    { minLength: 1, maxLength: maxShelves },
  );
  const wineArb = fc.record({
    chateau: fc.constantFrom(...CHATEAUX),
    annee: fc.constantFrom(...ANNEES),
    forme: fc.constantFrom(...formes),
    collection: fc.integer({ min: 0, max: 9 }).map((x) => x === 0),
  });
  const poolSize = Math.min(maxShelves * maxCapacity, Number.isFinite(maxSlots) ? maxSlots : Infinity);
  const drawArb = fc.tuple(fc.integer({ min: 0, max: 99 }), fc.nat({ max: 999 }));
  return fc
    .tuple(
      shelvesArb,
      fc.array(wineArb, { minLength: 1, maxLength: maxWines }),
      fc.constantFrom(...FILL_RATES),
      fc.array(drawArb, { minLength: poolSize, maxLength: poolSize }),
    )
    .map(([rawShelves, wines, fill, draws]) => {
      const shelves: Shelf[] = [];
      let total = 0;
      for (const shelf of rawShelves) {
        if (total + shelf.capacite > maxSlots) {
          if (shelves.length === 0) shelves.push({ ...shelf, capacite: maxSlots });
          break;
        }
        shelves.push(shelf);
        total += shelf.capacite;
      }
      const bottles: Bottle[] = [];
      let j = 0;
      shelves.forEach((shelf, i) => {
        for (let r = 1; r <= shelf.capacite; r++, j++) {
          const [dice, pick] = draws[j]!;
          if (dice >= fill || bottles.length >= maxBottles) continue;
          const compatibles = wines.filter((x) => isCompatible(x.forme, shelf.type));
          // Aucun vin du catalogue ne convient : on adapte la forme (même groupe, autre classe).
          const wine =
            compatibles.length > 0
              ? compatibles[pick % compatibles.length]!
              : { ...wines[pick % wines.length]!, forme: shelf.type as Forme };
          bottles.push(makeBottle(`b${bottles.length + 1}`, wine, i + 1, r));
        }
      });
      return { shelves, bottles };
    });
}

/* ------------------------------------------------------------------ */
/* Grandes caves pseudo-aléatoires (performances, mesures)             */
/* ------------------------------------------------------------------ */

/** Générateur pseudo-aléatoire déterministe (mulberry32), valeurs dans [0, 1[. */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface RandomCellarOptions {
  shelves: number;
  capacity: number;
  /** Taux de remplissage, de 0 à 1. */
  fill: number;
  seed: number;
  /** Nombre de châteaux distincts (défaut 40). */
  chateaux?: number;
  /** Types de clayettes, tirés au hasard (défaut : toutes « tout »). */
  types?: readonly TypeClayette[];
}

/** Grande cave valide pseudo-aléatoire : millésimes 1990–2022, quelques non millésimés, doublons fréquents. */
export function randomCellar(options: RandomCellarOptions): Cellar {
  const { shelves: nShelves, capacity, fill, seed, chateaux = 40, types = ['tout'] } = options;
  const rand = prng(seed);
  const int = (n: number): number => Math.floor(rand() * n);
  const shelves: Shelf[] = Array.from({ length: nShelves }, () => ({
    capacite: capacity,
    type: types[int(types.length)]!,
  }));
  const bottles: Bottle[] = [];
  shelves.forEach((shelf, i) => {
    for (let r = 1; r <= capacity; r++) {
      if (rand() >= fill) continue;
      const forme: Forme = shelf.type === 'tout' ? FORMES[int(FORMES.length)]! : shelf.type;
      const annee = int(12) === 0 ? null : 1990 + int(33);
      const wine = { chateau: `Château ${int(chateaux)}`, annee, forme };
      bottles.push(makeBottle(`b${bottles.length + 1}`, wine, i + 1, r));
    }
  });
  return { shelves, bottles };
}

/**
 * Simule la vie d'une cave : retire `remove` bouteilles au hasard (bues) puis en
 * ajoute `add` nouvelles sur des emplacements libres compatibles tirés au hasard.
 */
export function perturbCellar(
  cellar: Cellar,
  options: { seed: number; remove: number; add: number; chateaux?: number },
): Cellar {
  const rand = prng(options.seed);
  const int = (n: number): number => Math.floor(rand() * n);
  const bottles = [...cellar.bottles];
  for (let i = 0; i < options.remove && bottles.length > 0; i++) bottles.splice(int(bottles.length), 1);
  const taken = new Set(bottles.map((b) => `${b.clayette}:${b.rang}`));
  const free: { clayette: number; rang: number; type: TypeClayette }[] = [];
  cellar.shelves.forEach((shelf, i) => {
    for (let r = 1; r <= shelf.capacite; r++) {
      if (!taken.has(`${i + 1}:${r}`)) free.push({ clayette: i + 1, rang: r, type: shelf.type });
    }
  });
  for (let i = 0; i < options.add && free.length > 0; i++) {
    const [slot] = free.splice(int(free.length), 1);
    const forme: Forme = slot!.type === 'tout' ? FORMES[int(FORMES.length)]! : slot!.type;
    const wine = { chateau: `Château ${int(options.chateaux ?? 40)}`, annee: 1990 + int(33), forme };
    bottles.push(makeBottle(`n${options.seed}-${i}`, wine, slot!.clayette, slot!.rang));
  }
  return { shelves: cellar.shelves, bottles };
}

/* ------------------------------------------------------------------ */
/* Déplacements bruts (indices d'emplacements)                         */
/* ------------------------------------------------------------------ */

/**
 * Rejoue une suite de déplacements bruts en vérifiant chaque coup (source occupée,
 * destination libre et compatible, au plus une bouteille hors cave). Lève une erreur
 * au premier coup illégal ; renvoie l'arrangement final.
 */
export function simulateMoves(
  slots: readonly SlotInfo[],
  formes: readonly Forme[],
  current: ArrayLike<number>,
  moves: readonly { from: number; to: number; temporaire: boolean }[],
): number[] {
  const arr = Array.from(current);
  let out = VIDE;
  moves.forEach((move, i) => {
    let classe: number;
    if (move.from === -1) {
      if (out === VIDE) throw new Error(`coup ${i} : aucune bouteille hors cave`);
      classe = out;
      out = VIDE;
    } else {
      classe = arr[move.from] ?? VIDE;
      if (classe === VIDE) throw new Error(`coup ${i} : emplacement source ${move.from} vide`);
      arr[move.from] = VIDE;
    }
    if (move.to === -1) {
      if (out !== VIDE) throw new Error(`coup ${i} : deux bouteilles hors cave`);
      if (move.from === -1) throw new Error(`coup ${i} : hors cave vers hors cave`);
      out = classe;
    } else {
      if (arr[move.to] !== VIDE) throw new Error(`coup ${i} : destination ${move.to} occupée`);
      if (!isCompatible(formes[classe]!, slots[move.to]!.type)) throw new Error(`coup ${i} : type incompatible`);
      arr[move.to] = classe;
    }
  });
  if (out !== VIDE) throw new Error('une bouteille reste hors cave');
  return arr;
}

/**
 * Mélange valide d'un arrangement : pour chaque paire d'emplacements, échange leurs
 * contenus si chacun est compatible avec l'emplacement de l'autre.
 */
export function shuffleArrangement(
  slots: readonly SlotInfo[],
  formes: readonly Forme[],
  current: ArrayLike<number>,
  pairs: readonly (readonly [number, number])[],
): number[] {
  const arr = Array.from(current);
  if (arr.length === 0) return arr;
  const fits = (classe: number, slot: number): boolean =>
    classe === VIDE || isCompatible(formes[classe]!, slots[slot]!.type);
  for (const [x, y] of pairs) {
    const a = x % arr.length;
    const b = y % arr.length;
    if (fits(arr[a]!, b) && fits(arr[b]!, a)) [arr[a], arr[b]] = [arr[b]!, arr[a]!];
  }
  return arr;
}

/* ------------------------------------------------------------------ */
/* Recherche exhaustive du nombre minimal de déplacements              */
/* ------------------------------------------------------------------ */

/**
 * Parcours en largeur des états (classe par emplacement + au plus une bouteille hors
 * cave). Coups : déplacer une bouteille vers un emplacement libre compatible, la poser
 * hors de la cave (si personne n'y est), ou remettre la bouteille sortie sur un
 * emplacement libre compatible. Renvoie le nombre minimal de coups pour atteindre
 * `target` (avec aucune bouteille dehors), ou -1 si c'est impossible.
 */
export function bruteForceMinMoves(
  slots: readonly SlotInfo[],
  formes: readonly Forme[],
  current: ArrayLike<number>,
  target: ArrayLike<number>,
): number {
  const M = slots.length;
  const encode = (arr: readonly number[], out: number): string => `${arr.join(',')}/${out}`;
  const fits = (classe: number, slot: number): boolean => isCompatible(formes[classe]!, slots[slot]!.type);
  const goal = encode(Array.from(target), VIDE);
  const start = Array.from(current);
  if (encode(start, VIDE) === goal) return 0;
  const seen = new Set<string>([encode(start, VIDE)]);
  let frontier: { arr: number[]; out: number }[] = [{ arr: start, out: VIDE }];
  for (let depth = 1; frontier.length > 0; depth++) {
    const next: { arr: number[]; out: number }[] = [];
    const visit = (arr: number[], out: number): boolean => {
      const key = encode(arr, out);
      if (key === goal) return true;
      if (!seen.has(key)) {
        seen.add(key);
        next.push({ arr, out });
      }
      return false;
    };
    for (const { arr, out } of frontier) {
      for (let t = 0; t < M; t++) {
        if (arr[t] !== VIDE) continue;
        // Remettre la bouteille sortie.
        if (out !== VIDE && fits(out, t)) {
          const copy = [...arr];
          copy[t] = out;
          if (visit(copy, VIDE)) return depth;
        }
        // Déplacer une bouteille de la cave vers l'emplacement libre t.
        for (let s = 0; s < M; s++) {
          const c = arr[s]!;
          if (c === VIDE || !fits(c, t)) continue;
          const copy = [...arr];
          copy[t] = c;
          copy[s] = VIDE;
          if (visit(copy, out)) return depth;
        }
      }
      // Poser une bouteille hors de la cave.
      if (out === VIDE) {
        for (let s = 0; s < M; s++) {
          const c = arr[s]!;
          if (c === VIDE) continue;
          const copy = [...arr];
          copy[s] = VIDE;
          if (visit(copy, c)) return depth;
        }
      }
    }
    frontier = next;
  }
  return -1;
}
