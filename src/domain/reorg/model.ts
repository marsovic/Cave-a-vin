/**
 * Modèle interne de la réorganisation.
 *
 * Le planificateur ne raisonne pas sur les bouteilles physiques mais sur des
 * CLASSES d'interchangeabilité (`identityKey`) posées sur les emplacements
 * numérotés dans l'ordre de lecture (clayette croissante puis rang croissant,
 * indices base 0). Un « arrangement » associe à chaque emplacement une classe
 * ou `VIDE`.
 *
 * Les numéros de classe et de groupe sont attribués dans l'ordre de leurs clés :
 * tout le calcul ne dépend donc que de l'arrangement des classes, jamais de
 * l'ordre du tableau `cellar.bottles` ni des identifiants des bouteilles.
 */
import { isCompatible, validateCellar } from '../cellar';
import { groupKey, identityKey, norm } from '../normalize';
import type { Cellar, Forme, TypeClayette } from '../types';

/** Marque un emplacement libre dans un arrangement. */
export const VIDE = -1;

/** Un emplacement de la cave, dans l'ordre de lecture. */
export interface SlotInfo {
  /** N° de clayette (base 1). */
  clayette: number;
  /** N° de rang (base 1). */
  rang: number;
  type: TypeClayette;
}

/** Une classe de bouteilles physiquement identiques. */
export interface ClassInfo {
  /** Clé d'interchangeabilité (`identityKey`). */
  key: string;
  forme: Forme;
  annee: number | null;
  /** Numéro du groupe (même château normalisé + même année). */
  groupe: number;
  /** Château normalisé (ordre alphabétique des groupes). */
  chateau: string;
}

/** `arrangement[j]` = classe posée sur l'emplacement `j`, ou `VIDE`. */
export type Arrangement = Int32Array;

export interface ReorgModel {
  slots: SlotInfo[];
  /** Pour chaque emplacement, indice du premier emplacement de sa clayette. */
  shelfStart: Int32Array;
  classes: ClassInfo[];
  nGroupes: number;
}

/** Compare deux chaînes par unités de code (indépendant de la langue du système). */
export function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Construit la liste des emplacements (ordre de lecture) d'une configuration de clayettes. */
export function buildSlots(shelves: Cellar['shelves']): { slots: SlotInfo[]; shelfStart: Int32Array } {
  const slots: SlotInfo[] = [];
  const starts: number[] = [];
  shelves.forEach((shelf, i) => {
    const start = slots.length;
    for (let r = 1; r <= shelf.capacite; r++) {
      slots.push({ clayette: i + 1, rang: r, type: shelf.type });
      starts.push(start);
    }
  });
  return { slots, shelfStart: Int32Array.from(starts) };
}

export interface BuiltModel {
  model: ReorgModel;
  /** Arrangement courant de la cave. */
  arrangement: Arrangement;
  /** Identifiant de la bouteille posée sur chaque emplacement (`null` si libre). */
  bottleIds: (string | null)[];
}

/**
 * Traduit une cave en modèle + arrangement courant.
 * @throws si la cave ne respecte pas ses invariants (voir `validateCellar`).
 */
export function buildModel(cellar: Cellar): BuiltModel {
  const problems = validateCellar(cellar);
  if (problems.length > 0) {
    throw new Error(`Réorganisation impossible : la cave contient une anomalie. ${problems[0]}`);
  }
  const { slots, shelfStart } = buildSlots(cellar.shelves);

  // Indice de l'emplacement (clayette, rang) dans l'ordre de lecture.
  const firstOfShelf: number[] = [];
  let acc = 0;
  for (const shelf of cellar.shelves) {
    firstOfShelf.push(acc);
    acc += shelf.capacite;
  }

  // Classes et groupes numérotés dans l'ordre de leurs clés (déterminisme).
  const byKey = new Map<string, Omit<ClassInfo, 'groupe'> & { gkey: string }>();
  const keyOfBottle: string[] = [];
  for (const b of cellar.bottles) {
    const key = identityKey(b);
    keyOfBottle.push(key);
    if (!byKey.has(key)) {
      byKey.set(key, { key, forme: b.forme, annee: b.annee, chateau: norm(b.chateau), gkey: groupKey(b) });
    }
  }
  const sortedClasses = [...byKey.values()].sort((a, b) => compareText(a.key, b.key));
  const groupIds = new Map<string, number>();
  for (const gkey of [...new Set(sortedClasses.map((c) => c.gkey))].sort(compareText)) {
    groupIds.set(gkey, groupIds.size);
  }
  const classIds = new Map<string, number>();
  const classes: ClassInfo[] = sortedClasses.map((c, i) => {
    classIds.set(c.key, i);
    return { key: c.key, forme: c.forme, annee: c.annee, chateau: c.chateau, groupe: groupIds.get(c.gkey)! };
  });

  const arrangement = new Int32Array(slots.length).fill(VIDE);
  const bottleIds: (string | null)[] = new Array<string | null>(slots.length).fill(null);
  cellar.bottles.forEach((b, i) => {
    const j = firstOfShelf[b.clayette - 1]! + b.rang - 1;
    arrangement[j] = classIds.get(keyOfBottle[i]!)!;
    bottleIds[j] = b.id;
  });

  return { model: { slots, shelfStart, classes, nGroupes: groupIds.size }, arrangement, bottleIds };
}

/** La classe `classe` peut-elle être posée sur l'emplacement `slot` ? */
export function classFits(model: ReorgModel, classe: number, slot: number): boolean {
  return isCompatible(model.classes[classe]!.forme, model.slots[slot]!.type);
}

/**
 * Exceptions d'ordre d'un arrangement : paires de bouteilles voisines dans l'ordre
 * de lecture (emplacements vides ignorés) où l'année décroît ; sans millésime = +∞.
 */
export function countOrderExceptions(model: ReorgModel, arrangement: Arrangement): number {
  let count = 0;
  let last = -Infinity;
  for (let j = 0; j < arrangement.length; j++) {
    const c = arrangement[j]!;
    if (c === VIDE) continue;
    const year = model.classes[c]!.annee ?? Infinity;
    if (year < last) count += 1;
    last = year;
  }
  return count;
}

/**
 * Groupes d'au moins deux bouteilles qui ne sont pas d'un seul tenant sur une
 * même clayette (répartis sur plusieurs clayettes, ou séparés par un vide ou
 * par une autre bouteille).
 */
export function countSplitGroups(model: ReorgModel, arrangement: Arrangement): number {
  const first = new Int32Array(model.nGroupes).fill(-1);
  const last = new Int32Array(model.nGroupes).fill(-1);
  const size = new Int32Array(model.nGroupes);
  for (let j = 0; j < arrangement.length; j++) {
    const c = arrangement[j]!;
    if (c === VIDE) continue;
    const g = model.classes[c]!.groupe;
    if (first[g] === -1) first[g] = j;
    last[g] = j;
    size[g] = size[g]! + 1;
  }
  let count = 0;
  for (let g = 0; g < model.nGroupes; g++) {
    if (size[g]! < 2) continue;
    const sameShelf = model.shelfStart[first[g]!] === model.shelfStart[last[g]!];
    if (!sameShelf || last[g]! - first[g]! + 1 !== size[g]!) count += 1;
  }
  return count;
}

/**
 * Nombre minimal de bouteilles à écarter pour que les années soient croissantes
 * dans l'ordre de lecture (taille − plus longue sous-suite croissante au sens large).
 */
export function countOutOfOrder(model: ReorgModel, arrangement: Arrangement): number {
  // `tails[k]` = plus petite année terminant une sous-suite croissante de longueur k + 1.
  const tails: number[] = [];
  let n = 0;
  for (let j = 0; j < arrangement.length; j++) {
    const c = arrangement[j]!;
    if (c === VIDE) continue;
    n += 1;
    const year = model.classes[c]!.annee ?? Infinity;
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (tails[mid]! <= year) lo = mid + 1;
      else hi = mid;
    }
    tails[lo] = year;
  }
  return n - tails.length;
}
