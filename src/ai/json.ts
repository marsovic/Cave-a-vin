/**
 * Lecture tolérante du JSON renvoyé par un modèle de langage, et petits validateurs
 * sans dépendance.
 */

function tryParse(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false };
  }
}

/**
 * Fin (index inclus) de l'objet ou du tableau équilibré qui commence à `start`,
 * en ignorant les accolades / crochets placés dans des chaînes ; `-1` s'il n'est pas fermé.
 */
function balancedEnd(text: string, start: number): number {
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === '{') {
      stack.push('}');
    } else if (ch === '[') {
      stack.push(']');
    } else if (ch === '}' || ch === ']') {
      if (stack.pop() !== ch) return -1;
      if (stack.length === 0) return i;
    }
  }
  return -1;
}

/** Premier objet / tableau JSON équilibré et valide trouvé dans `text`. */
function firstBalanced(text: string): { ok: true; value: unknown } | { ok: false } {
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch !== '{' && ch !== '[') continue;
    const end = balancedEnd(text, i);
    if (end < 0) continue;
    const parsed = tryParse(text.slice(i, end + 1));
    if (parsed.ok) return parsed;
  }
  return { ok: false };
}

/**
 * Extrait la première valeur JSON structurée (objet ou tableau) d'une réponse de modèle :
 * JSON seul, bloc ```json … ```, ou JSON entouré de texte. Renvoie `null` si rien n'est exploitable.
 */
export function extractJson(text: string): unknown | null {
  if (typeof text !== 'string') return null;
  const trimmed = text.replace(/^﻿/, '').trim();
  if (!trimmed) return null;

  const direct = tryParse(trimmed);
  if (direct.ok && typeof direct.value === 'object' && direct.value !== null) return direct.value;

  for (const match of trimmed.matchAll(/```[a-zA-Z0-9_-]*[ \t]*\r?\n?([\s\S]*?)```/g)) {
    const inner = (match[1] ?? '').trim();
    if (!inner) continue;
    const fenced = tryParse(inner);
    if (fenced.ok && typeof fenced.value === 'object' && fenced.value !== null) return fenced.value;
    const nested = firstBalanced(inner);
    if (nested.ok) return nested.value;
  }

  const found = firstBalanced(trimmed);
  return found.ok ? found.value : null;
}

/* ------------------------------------------------------------------ */
/* Validateurs                                                         */
/* ------------------------------------------------------------------ */

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Chaîne nettoyée (espaces compactés), ou `null` si la valeur n'est pas une chaîne non vide. */
export function asText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.replace(/\s+/g, ' ').trim();
  return clean ? clean : null;
}

/** Entier, y compris écrit en chaîne (« 2015 ») ou en flottant entier (2015.0) ; sinon `null`. */
export function asInteger(value: unknown): number | null {
  if (typeof value === 'number') return Number.isInteger(value) ? value : null;
  if (typeof value === 'string' && /^\s*-?\d{1,9}\s*$/.test(value)) return Number(value);
  return null;
}

/** Nombre fini, y compris écrit en chaîne ; sinon `null`. */
export function asNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && /^\s*-?\d+(?:[.,]\d+)?\s*$/.test(value)) return Number(value.replace(',', '.'));
  return null;
}

/** Liste des chaînes non vides d'un tableau (les autres éléments sont ignorés) ; `[]` sinon. */
export function asTextArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    const text = asText(item);
    if (text !== null) out.push(text);
  }
  return out;
}

/** `value` si elle appartient à la liste `allowed`, sinon `null`. */
export function asOneOf<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Coupe un texte à `max` caractères (points de suspension compris). */
export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

/**
 * Tableau contenu dans une réponse : la réponse elle-même si c'est un tableau, sinon la
 * propriété `key`, sinon l'unique propriété de type tableau. `null` si introuvable.
 */
export function findArray(value: unknown, key: string): unknown[] | null {
  if (Array.isArray(value)) return value;
  if (!isRecord(value)) return null;
  const direct = value[key];
  if (Array.isArray(direct)) return direct;
  const arrays = Object.values(value).filter((v): v is unknown[] => Array.isArray(v));
  return arrays.length === 1 ? (arrays[0] ?? null) : null;
}
