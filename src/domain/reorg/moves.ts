/**
 * Suite MINIMALE de déplacements pour passer d'un arrangement à un autre.
 *
 * Les deux arrangements sont exprimés en classes de bouteilles interchangeables
 * par emplacement (voir `model.ts`). Principe :
 *
 *  1. un emplacement dont la classe courante est déjà la classe cible ne bouge pas ;
 *  2. on construit un multigraphe orienté dont les nœuds sont les classes plus un
 *     nœud VIDE, avec une arête `courant(s) → cible(s)` par emplacement mal placé.
 *     Chaque nœud a autant d'arêtes entrantes que sortantes : chaque composante
 *     connexe possède un circuit eulérien (algorithme de Hierholzer) ;
 *  3. composante contenant VIDE : le circuit, découpé à chaque passage par VIDE,
 *     donne des CHAÎNES `s1..sk` (s1 libre, la bouteille de s(i+1) est attendue en
 *     s(i), sk se libère) → k − 1 déplacements directs et définitifs ;
 *  4. composante sans VIDE : le circuit `s1..sk` est un CYCLE ; il faut mettre une
 *     bouteille de côté (emplacement tampon libre et compatible, à défaut hors de
 *     la cave) → k + 1 déplacements.
 *
 * Total : (bouteilles mal placées) + (composantes sans VIDE), ce qui est le
 * minimum possible pour une cible donnée (vérifié par force brute dans les tests).
 */
import { isCompatible } from '../cellar';
import type { Forme } from '../types';
import { VIDE, type SlotInfo } from './model';

/** Lieu « hors de la cave » dans un déplacement brut. */
export const HORS_CAVE = -1;

/** Déplacement élémentaire entre emplacements (indices en ordre de lecture) ou `HORS_CAVE`. */
export interface RawMove {
  from: number;
  to: number;
  /** La destination est provisoire (tampon ou hors cave). */
  temporaire: boolean;
}

export interface MovesInput {
  slots: readonly SlotInfo[];
  /** Forme des bouteilles de chaque classe. */
  formes: readonly Forme[];
  /** Classe courante de chaque emplacement (ou `VIDE`). */
  current: ArrayLike<number>;
  /** Classe voulue sur chaque emplacement (ou `VIDE`). */
  target: ArrayLike<number>;
}

/**
 * Nombre minimal de déplacements entre deux arrangements, sans construire la suite :
 * (bouteilles mal placées) + (composantes du graphe des échanges ne passant pas par un vide).
 */
export function countMoves(current: ArrayLike<number>, target: ArrayLike<number>, nClasses: number): number {
  const vide = nClasses;
  const parent = Int32Array.from({ length: nClasses + 1 }, (_, i) => i);
  const find = (x: number): number => {
    let r = x;
    while (parent[r] !== r) r = parent[r]!;
    while (parent[x] !== r) {
      const next = parent[x]!;
      parent[x] = r;
      x = next;
    }
    return r;
  };
  let misplaced = 0;
  for (let s = 0; s < current.length; s++) {
    const c = current[s]!;
    const t = target[s]!;
    if (c === t) continue;
    if (c !== VIDE) misplaced += 1;
    parent[find(c === VIDE ? vide : c)] = find(t === VIDE ? vide : t);
  }
  const rootVide = find(vide);
  const cycles = new Set<number>();
  for (let s = 0; s < current.length; s++) {
    const c = current[s]!;
    if (c === target[s] || c === VIDE) continue;
    const r = find(c);
    if (r !== rootVide) cycles.add(r);
  }
  return misplaced + cycles.size;
}

/** Calcule la suite minimale de déplacements (voir l'en-tête du fichier). */
export function planMoves(input: MovesInput): RawMove[] {
  const { slots, formes, current, target } = input;
  const M = slots.length;
  const vide = formes.length;
  const node = (c: number): number => (c === VIDE ? vide : c);

  // Vérification : les deux arrangements portent les mêmes bouteilles.
  const balance = new Int32Array(vide + 1);
  for (let s = 0; s < M; s++) {
    balance[node(current[s]!)]! += 1;
    balance[node(target[s]!)]! -= 1;
  }
  if (balance.some((x) => x !== 0)) {
    throw new Error('Arrangements incohérents : la cible ne contient pas les mêmes bouteilles que la cave.');
  }

  // Arêtes sortantes de chaque nœud = emplacements mal placés, du haut vers le bas.
  const out: number[][] = Array.from({ length: vide + 1 }, () => []);
  for (let s = 0; s < M; s++) {
    if (current[s] !== target[s]) out[node(current[s]!)]!.push(s);
  }
  const used = new Int32Array(vide + 1);

  /** Circuit eulérien (Hierholzer itératif) de la composante de `start`, en liste d'emplacements. */
  const eulerCircuit = (start: number): number[] => {
    const nodeStack: number[] = [start];
    const edgeStack: number[] = [];
    const circuit: number[] = [];
    while (nodeStack.length > 0) {
      const v = nodeStack[nodeStack.length - 1]!;
      const edges = out[v]!;
      if (used[v]! < edges.length) {
        const s = edges[used[v]!]!;
        used[v]! += 1;
        nodeStack.push(node(target[s]!));
        edgeStack.push(s);
      } else {
        nodeStack.pop();
        const s = edgeStack.pop();
        if (s !== undefined) circuit.push(s);
      }
    }
    return circuit.reverse();
  };

  // Chaînes : circuit de la composante de VIDE, découpé à chaque emplacement libre.
  const chains: number[][] = [];
  if (out[vide]!.length > 0) {
    let chain: number[] = [];
    for (const s of eulerCircuit(vide)) {
      if (current[s] === VIDE) {
        if (chain.length > 0) chains.push(chain);
        chain = [s];
      } else {
        chain.push(s);
      }
    }
    if (chain.length > 0) chains.push(chain);
  }
  chains.sort((a, b) => a[0]! - b[0]!);

  // Cycles : circuits des composantes restantes, dans l'ordre de lecture.
  const cycles: number[][] = [];
  for (let s = 0; s < M; s++) {
    const c = current[s]!;
    if (c !== target[s] && c !== VIDE && used[c]! < out[c]!.length) cycles.push(eulerCircuit(c));
  }

  // Emplacements libres avant tout déplacement, et une fois toutes les chaînes faites.
  const freeBefore: number[] = [];
  const freeAfter: number[] = [];
  for (let s = 0; s < M; s++) {
    if (current[s] === VIDE) freeBefore.push(s);
    if (target[s] === VIDE) freeAfter.push(s);
  }

  /**
   * Meilleure rotation du cycle et meilleur tampon parmi `free` : la bouteille mise de
   * côté reste sur sa clayette si possible, sinon va sur la clayette la plus proche.
   */
  const chooseBuffer = (cycle: number[], free: number[]): { rotation: number; buffer: number } | null => {
    let best: { rotation: number; buffer: number } | null = null;
    let bestShelf = Infinity;
    let bestRang = Infinity;
    let bestSlot = Infinity;
    for (let rotation = 0; rotation < cycle.length; rotation++) {
      const s = cycle[rotation]!;
      const forme = formes[current[s]!]!;
      const here = slots[s]!;
      for (const b of free) {
        const there = slots[b]!;
        if (!isCompatible(forme, there.type)) continue;
        const dShelf = Math.abs(there.clayette - here.clayette);
        const dRang = Math.abs(there.rang - here.rang);
        if (
          dShelf < bestShelf ||
          (dShelf === bestShelf && (dRang < bestRang || (dRang === bestRang && s < bestSlot)))
        ) {
          best = { rotation, buffer: b };
          bestShelf = dShelf;
          bestRang = dRang;
          bestSlot = s;
        }
      }
    }
    return best;
  };

  const chainMoves = (chain: number[]): RawMove[] => {
    const moves: RawMove[] = [];
    for (let i = 1; i < chain.length; i++) moves.push({ from: chain[i]!, to: chain[i - 1]!, temporaire: false });
    return moves;
  };

  const cycleMoves = (cycle: number[], rotation: number, buffer: number): RawMove[] => {
    const k = cycle.length;
    const at = (i: number): number => cycle[(rotation + i) % k]!;
    const moves: RawMove[] = [{ from: at(0), to: buffer, temporaire: true }];
    for (let i = 1; i < k; i++) moves.push({ from: at(i), to: at(i - 1), temporaire: false });
    moves.push({ from: buffer, to: at(k - 1), temporaire: false });
    return moves;
  };

  // Ordonnancement : les chaînes d'abord, puis les cycles. Seule exception : un cycle
  // qui ne trouverait plus de tampon après les chaînes, mais en a un tant que rien n'a
  // bougé, passe en tête (cela évite de poser une bouteille hors de la cave).
  const early: RawMove[] = [];
  const late: RawMove[] = [];
  for (const cycle of cycles) {
    const after = chooseBuffer(cycle, freeAfter);
    if (after) {
      late.push(...cycleMoves(cycle, after.rotation, after.buffer));
      continue;
    }
    const before = chooseBuffer(cycle, freeBefore);
    if (before) {
      early.push(...cycleMoves(cycle, before.rotation, before.buffer));
      continue;
    }
    // Aucun tampon : on part de l'emplacement le plus haut du cycle, bouteille hors cave.
    let rotation = 0;
    cycle.forEach((s, i) => {
      if (s < cycle[rotation]!) rotation = i;
    });
    late.push(...cycleMoves(cycle, rotation, HORS_CAVE));
  }

  return [...early, ...chains.flatMap(chainMoves), ...late];
}
