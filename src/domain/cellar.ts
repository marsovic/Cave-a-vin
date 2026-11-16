import { formatSlot, formatWine, FORME_LABELS, TYPE_CLAYETTE_LABELS } from './labels';
import {
  ROBES,
  SHELF_LIMITS,
  type Bottle,
  type Cellar,
  type Forme,
  type Result,
  type Robe,
  type Shelf,
  type SlotRef,
  type TypeClayette,
  type WineFields,
} from './types';

/* ------------------------------------------------------------------ */
/* Construction                                                        */
/* ------------------------------------------------------------------ */

let idCounter = 0;

/** Génère un identifiant technique unique pour une bouteille (UUID, comme dans le fichier de la cave). */
export function newBottleId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  idCounter += 1;
  const rand = Math.floor(Math.random() * 0xffffffff)
    .toString(16)
    .padStart(8, '0');
  return `b${Date.now().toString(36)}${idCounter.toString(36)}${rand}`;
}

export function createCellar(shelves: Shelf[]): Cellar {
  return { shelves: shelves.map((s) => ({ ...s })), bottles: [] };
}

/**
 * Cave par défaut : l'armoire modélisée — 9 clayettes de 13 places « bordeaux », puis une
 * clayette de 12 places « bourgogne » et une de 10 places « champagne » (139 emplacements).
 */
export function defaultCellar(): Cellar {
  const shelf = (capacite: number, type: TypeClayette): Shelf => ({ capacite, type });
  return createCellar([
    ...Array.from({ length: 9 }, () => shelf(13, 'bordeaux')),
    shelf(12, 'bourgogne'),
    shelf(10, 'champagne'),
  ]);
}

/* ------------------------------------------------------------------ */
/* Lecture                                                             */
/* ------------------------------------------------------------------ */

/** Une bouteille de forme `forme` peut-elle être posée sur une clayette de type `type` ? */
export function isCompatible(forme: Forme, type: TypeClayette): boolean {
  return type === 'tout' || type === forme;
}

export function sameSlot(a: SlotRef, b: SlotRef): boolean {
  return a.clayette === b.clayette && a.rang === b.rang;
}

export function slotKey(slot: SlotRef): string {
  return `${slot.clayette}:${slot.rang}`;
}

export function isValidSlot(cellar: Cellar, slot: SlotRef): boolean {
  const shelf = cellar.shelves[slot.clayette - 1];
  return (
    Number.isInteger(slot.clayette) &&
    Number.isInteger(slot.rang) &&
    shelf !== undefined &&
    slot.rang >= 1 &&
    slot.rang <= shelf.capacite
  );
}

export function shelfOf(cellar: Cellar, clayette: number): Shelf | undefined {
  return cellar.shelves[clayette - 1];
}

export function bottleAt(cellar: Cellar, slot: SlotRef): Bottle | undefined {
  return cellar.bottles.find((b) => b.clayette === slot.clayette && b.rang === slot.rang);
}

export function bottleById(cellar: Cellar, id: string): Bottle | undefined {
  return cellar.bottles.find((b) => b.id === id);
}

/** Index « clayette:rang » → bouteille, pour les parcours intensifs. */
export function occupancy(cellar: Cellar): Map<string, Bottle> {
  const map = new Map<string, Bottle>();
  for (const b of cellar.bottles) map.set(slotKey(b), b);
  return map;
}

/** Tous les emplacements de la cave, dans l'ordre de lecture (haut → bas, gauche → droite). */
export function allSlots(cellar: Cellar): SlotRef[] {
  const out: SlotRef[] = [];
  cellar.shelves.forEach((shelf, i) => {
    for (let r = 1; r <= shelf.capacite; r++) out.push({ clayette: i + 1, rang: r });
  });
  return out;
}

/**
 * Emplacements libres, dans l'ordre de lecture.
 * `forme` : ne garde que les emplacements compatibles avec cette forme de bouteille.
 * `clayette` / `rang` : restreint à cette clayette / ce rang.
 */
export function freeSlots(
  cellar: Cellar,
  filter: { forme?: Forme | ''; clayette?: number; rang?: number } = {},
): SlotRef[] {
  const occ = occupancy(cellar);
  return allSlots(cellar).filter((slot) => {
    if (occ.has(slotKey(slot))) return false;
    if (filter.clayette !== undefined && slot.clayette !== filter.clayette) return false;
    if (filter.rang !== undefined && slot.rang !== filter.rang) return false;
    if (filter.forme) {
      const shelf = cellar.shelves[slot.clayette - 1]!;
      if (!isCompatible(filter.forme, shelf.type)) return false;
    }
    return true;
  });
}

/** Bouteilles triées dans l'ordre de lecture de la cave. */
export function bottlesInReadingOrder(cellar: Cellar): Bottle[] {
  return [...cellar.bottles].sort((a, b) => a.clayette - b.clayette || a.rang - b.rang);
}

export interface CellarStats {
  /** Nombre total d'emplacements. */
  capacite: number;
  /** Nombre de bouteilles (collection comprise). */
  total: number;
  collection: number;
  libres: number;
  parRobe: Record<Robe, number>;
}

export function cellarStats(cellar: Cellar): CellarStats {
  const capacite = cellar.shelves.reduce((n, s) => n + s.capacite, 0);
  const parRobe = Object.fromEntries(ROBES.map((r) => [r, 0])) as Record<Robe, number>;
  let collection = 0;
  for (const b of cellar.bottles) {
    parRobe[b.robe] += 1;
    if (b.collection) collection += 1;
  }
  return { capacite, total: cellar.bottles.length, collection, libres: capacite - cellar.bottles.length, parRobe };
}

/* ------------------------------------------------------------------ */
/* Vérifications                                                       */
/* ------------------------------------------------------------------ */

function checkPlacement(cellar: Cellar, forme: Forme, slot: SlotRef): string | null {
  if (!isValidSlot(cellar, slot)) return `L'emplacement ${formatSlot(slot)} n'existe pas dans la cave.`;
  const shelf = cellar.shelves[slot.clayette - 1]!;
  if (!isCompatible(forme, shelf.type)) {
    return `Une bouteille de forme ${FORME_LABELS[forme]} ne peut pas aller sur la clayette ${slot.clayette} (emplacements ${TYPE_CLAYETTE_LABELS[shelf.type]}).`;
  }
  return null;
}

/** Vérifie les invariants de la cave ; renvoie la liste des anomalies (vide si tout va bien). */
export function validateCellar(cellar: Cellar): string[] {
  const problems: string[] = [];
  if (cellar.shelves.length < SHELF_LIMITS.minShelves || cellar.shelves.length > SHELF_LIMITS.maxShelves) {
    problems.push(`Nombre de clayettes invalide : ${cellar.shelves.length}.`);
  }
  cellar.shelves.forEach((s, i) => {
    if (!Number.isInteger(s.capacite) || s.capacite < SHELF_LIMITS.minCapacity || s.capacite > SHELF_LIMITS.maxCapacity) {
      problems.push(`Clayette ${i + 1} : nombre d'emplacements invalide (${s.capacite}).`);
    }
  });
  const ids = new Set<string>();
  const used = new Map<string, Bottle>();
  for (const b of cellar.bottles) {
    if (ids.has(b.id)) problems.push(`Identifiant en double : ${b.id}.`);
    ids.add(b.id);
    const err = checkPlacement(cellar, b.forme, b);
    if (err) problems.push(`${formatWine(b)} : ${err}`);
    const key = slotKey(b);
    const other = used.get(key);
    if (other) problems.push(`Deux bouteilles occupent ${formatSlot(b)} : ${formatWine(other)} et ${formatWine(b)}.`);
    used.set(key, b);
  }
  return problems;
}

/* ------------------------------------------------------------------ */
/* Opérations                                                          */
/* ------------------------------------------------------------------ */

function cleanWine(w: WineFields): WineFields {
  return {
    chateau: w.chateau.replace(/\s+/g, ' ').trim(),
    appellation: w.appellation.replace(/\s+/g, ' ').trim(),
    annee: w.annee,
    cepages: w.cepages.map((c) => c.replace(/\s+/g, ' ').trim()).filter(Boolean),
    robe: w.robe,
    forme: w.forme,
  };
}

/** Une année de millésime plausible ? */
export function isValidYear(annee: number): boolean {
  return Number.isInteger(annee) && annee >= 1800 && annee <= new Date().getFullYear() + 1;
}

/**
 * Ajoute une ou plusieurs bouteilles identiques aux emplacements indiqués
 * (un emplacement par bouteille). Échoue sans rien modifier si un seul
 * emplacement est invalide, occupé ou incompatible.
 */
export function addBottles(
  cellar: Cellar,
  wine: WineFields,
  slots: readonly SlotRef[],
  opts: { collection?: boolean } = {},
): Result<{ cellar: Cellar; added: Bottle[] }> {
  const w = cleanWine(wine);
  if (!w.chateau && !w.appellation) {
    return { ok: false, error: 'Indiquez au moins le château ou l\'appellation de la bouteille.' };
  }
  if (w.annee !== null && !isValidYear(w.annee)) {
    return { ok: false, error: `L'année ${w.annee} n'est pas un millésime valide.` };
  }
  if (slots.length === 0) return { ok: false, error: 'Aucun emplacement indiqué.' };
  const occ = occupancy(cellar);
  const seen = new Set<string>();
  for (const slot of slots) {
    const err = checkPlacement(cellar, w.forme, slot);
    if (err) return { ok: false, error: err };
    const key = slotKey(slot);
    const occupant = occ.get(key);
    if (occupant) {
      return { ok: false, error: `L'emplacement ${formatSlot(slot)} est déjà occupé par ${formatWine(occupant)}.` };
    }
    if (seen.has(key)) return { ok: false, error: `L'emplacement ${formatSlot(slot)} est indiqué deux fois.` };
    seen.add(key);
  }
  const added: Bottle[] = slots.map((slot) => ({
    ...w,
    cepages: [...w.cepages],
    id: newBottleId(),
    collection: opts.collection ?? false,
    clayette: slot.clayette,
    rang: slot.rang,
  }));
  return { ok: true, value: { cellar: { shelves: cellar.shelves, bottles: [...cellar.bottles, ...added] }, added } };
}

/** Retire les bouteilles dont l'identifiant est dans `ids`. */
export function removeBottles(cellar: Cellar, ids: readonly string[]): Cellar {
  const set = new Set(ids);
  return { shelves: cellar.shelves, bottles: cellar.bottles.filter((b) => !set.has(b.id)) };
}

/** Modifie la description d'une bouteille existante (sans la déplacer). */
export function updateBottle(cellar: Cellar, id: string, wine: WineFields): Result<Cellar> {
  const bottle = bottleById(cellar, id);
  if (!bottle) return { ok: false, error: 'Cette bouteille n\'existe plus.' };
  const w = cleanWine(wine);
  if (!w.chateau && !w.appellation) {
    return { ok: false, error: 'Indiquez au moins le château ou l\'appellation de la bouteille.' };
  }
  if (w.annee !== null && !isValidYear(w.annee)) {
    return { ok: false, error: `L'année ${w.annee} n'est pas un millésime valide.` };
  }
  const err = checkPlacement(cellar, w.forme, bottle);
  if (err) return { ok: false, error: `${err} Déplacez d'abord la bouteille.` };
  return {
    ok: true,
    value: { shelves: cellar.shelves, bottles: cellar.bottles.map((b) => (b.id === id ? { ...b, ...w } : b)) },
  };
}

/** Déplace une bouteille vers un emplacement libre et compatible. */
export function moveBottle(cellar: Cellar, id: string, to: SlotRef): Result<Cellar> {
  const bottle = bottleById(cellar, id);
  if (!bottle) return { ok: false, error: 'Cette bouteille n\'existe plus.' };
  if (sameSlot(bottle, to)) return { ok: false, error: 'La bouteille est déjà à cet emplacement.' };
  const err = checkPlacement(cellar, bottle.forme, to);
  if (err) return { ok: false, error: err };
  const occupant = bottleAt(cellar, to);
  if (occupant) {
    return { ok: false, error: `L'emplacement ${formatSlot(to)} est occupé par ${formatWine(occupant)}.` };
  }
  return {
    ok: true,
    value: {
      shelves: cellar.shelves,
      bottles: cellar.bottles.map((b) => (b.id === id ? { ...b, clayette: to.clayette, rang: to.rang } : b)),
    },
  };
}

/** Échange deux bouteilles (chacune doit être compatible avec la clayette de l'autre). */
export function swapBottles(cellar: Cellar, idA: string, idB: string): Result<Cellar> {
  const a = bottleById(cellar, idA);
  const b = bottleById(cellar, idB);
  if (!a || !b) return { ok: false, error: 'Une des deux bouteilles n\'existe plus.' };
  if (a.id === b.id) return { ok: false, error: 'Choisissez deux bouteilles différentes.' };
  const errA = checkPlacement(cellar, a.forme, b);
  if (errA) return { ok: false, error: `Échange impossible : ${errA}` };
  const errB = checkPlacement(cellar, b.forme, a);
  if (errB) return { ok: false, error: `Échange impossible : ${errB}` };
  return {
    ok: true,
    value: {
      shelves: cellar.shelves,
      bottles: cellar.bottles.map((x) => {
        if (x.id === a.id) return { ...x, clayette: b.clayette, rang: b.rang };
        if (x.id === b.id) return { ...x, clayette: a.clayette, rang: a.rang };
        return x;
      }),
    },
  };
}

/** Classe (`true`) ou déclasse (`false`) des bouteilles en « collection ». */
export function setCollection(cellar: Cellar, ids: readonly string[], collection: boolean): Cellar {
  const set = new Set(ids);
  return {
    shelves: cellar.shelves,
    bottles: cellar.bottles.map((b) => (set.has(b.id) && b.collection !== collection ? { ...b, collection } : b)),
  };
}

/**
 * Remplace la configuration des clayettes. Échoue (sans rien modifier) si des
 * bouteilles se retrouveraient hors de la cave ou sur une clayette incompatible ;
 * le message liste alors les bouteilles à déplacer d'abord.
 */
export function updateShelves(cellar: Cellar, shelves: readonly Shelf[]): Result<Cellar> {
  if (shelves.length < SHELF_LIMITS.minShelves || shelves.length > SHELF_LIMITS.maxShelves) {
    return {
      ok: false,
      error: `Le nombre de clayettes doit être compris entre ${SHELF_LIMITS.minShelves} et ${SHELF_LIMITS.maxShelves}.`,
    };
  }
  for (const [i, s] of shelves.entries()) {
    if (!Number.isInteger(s.capacite) || s.capacite < SHELF_LIMITS.minCapacity || s.capacite > SHELF_LIMITS.maxCapacity) {
      return {
        ok: false,
        error: `Clayette ${i + 1} : le nombre d'emplacements doit être compris entre ${SHELF_LIMITS.minCapacity} et ${SHELF_LIMITS.maxCapacity}.`,
      };
    }
  }
  const next: Cellar = { shelves: shelves.map((s) => ({ ...s })), bottles: cellar.bottles };
  const blockers = shelfChangeBlockers(cellar, shelves);
  if (blockers.length > 0) {
    const shown = blockers.slice(0, 5).map((b) => `• ${formatWine(b.bottle)} (${formatSlot(b.bottle)}) : ${b.reason}`);
    const more = blockers.length > 5 ? `\n… et ${blockers.length - 5} autre(s).` : '';
    return {
      ok: false,
      error: `Modification impossible : ${blockers.length} bouteille(s) à déplacer ou retirer d'abord.\n${shown.join('\n')}${more}`,
    };
  }
  return { ok: true, value: next };
}

/** Bouteilles qui empêcheraient d'appliquer une nouvelle configuration de clayettes. */
export function shelfChangeBlockers(
  cellar: Cellar,
  shelves: readonly Shelf[],
): { bottle: Bottle; reason: string }[] {
  const out: { bottle: Bottle; reason: string }[] = [];
  for (const b of bottlesInReadingOrder(cellar)) {
    const shelf = shelves[b.clayette - 1];
    if (!shelf) out.push({ bottle: b, reason: 'la clayette serait supprimée' });
    else if (b.rang > shelf.capacite) out.push({ bottle: b, reason: 'l\'emplacement serait supprimé' });
    else if (!isCompatible(b.forme, shelf.type)) {
      out.push({ bottle: b, reason: `forme ${FORME_LABELS[b.forme]} incompatible avec le type ${TYPE_CLAYETTE_LABELS[shelf.type]}` });
    }
  }
  return out;
}
