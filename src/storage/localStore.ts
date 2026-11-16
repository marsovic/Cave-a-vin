/**
 * Persistance dans le navigateur (localStorage). Toutes les fonctions sont sûres :
 * elles n'échouent jamais (stockage indisponible, quota dépassé, JSON corrompu → valeur par défaut / `false`).
 */

/** Clés utilisées (préfixe `dumbcellar.`). */
export const STORAGE_KEYS = {
  /** Copie de travail de la cave, au format CSV. */
  csv: 'dumbcellar.cave.csv',
  /** Métadonnées de la copie de travail (JSON). */
  meta: 'dumbcellar.cave.meta',
  /** Réglages IA (JSON `AiSettings`). */
  ai: 'dumbcellar.ai.settings',
  /** Cache des fenêtres de dégustation obtenues par l'IA (JSON). */
  aiCache: 'dumbcellar.ai.cache',
  /** Préférences d'interface (JSON). */
  prefs: 'dumbcellar.prefs',
  /** Session de réorganisation guidée en cours (JSON). */
  reorg: 'dumbcellar.reorg.session',
} as const;

/** Préfixe commun des clés ci-dessus. */
const PREFIX = 'dumbcellar.';
/**
 * Préfixe des clés du temps où l'application s'appelait autrement. Les données enregistrées
 * sous ces clés sont reprises à la première lecture, puis déplacées sous le nouveau préfixe.
 */
export const LEGACY_PREFIX = 'bacchus.';

/** Ancienne clé correspondant à `key`, ou `null` si `key` n'est pas une clé de l'application. */
function legacyKey(key: string): string | null {
  return key.startsWith(PREFIX) ? LEGACY_PREFIX + key.slice(PREFIX.length) : null;
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    // Accès refusé (cookies bloqués, iframe isolée…).
    return null;
  }
}

export function loadText(key: string): string | null {
  try {
    const s = storage();
    if (!s) return null;
    const value = s.getItem(key);
    if (value !== null) return value;
    // Rien sous le nom actuel : données enregistrées sous l'ancien nom de l'application ?
    const old = legacyKey(key);
    const legacy = old === null ? null : s.getItem(old);
    if (old === null || legacy === null) return null;
    try {
      s.setItem(key, legacy);
      s.removeItem(old);
    } catch {
      /* quota dépassé : l'ancienne clé reste en place et sera relue la prochaine fois */
    }
    return legacy;
  } catch {
    return null;
  }
}

/** Renvoie `false` si l'écriture a échoué (quota, navigation privée…). */
export function saveText(key: string, value: string): boolean {
  try {
    const s = storage();
    if (!s) return false;
    s.setItem(key, value);
    // La valeur enregistrée sous l'ancien nom de l'application est désormais périmée.
    const old = legacyKey(key);
    if (old !== null) s.removeItem(old);
    return true;
  } catch {
    return false;
  }
}

export function removeKey(key: string): void {
  try {
    const s = storage();
    s?.removeItem(key);
    // Sans quoi l'ancienne valeur reviendrait à la prochaine lecture.
    const old = legacyKey(key);
    if (old !== null) s?.removeItem(old);
  } catch {
    /* rien à faire */
  }
}

/** Lit du JSON ; renvoie `fallback` si absent ou illisible. */
export function loadJson<T>(key: string, fallback: T): T {
  const text = loadText(key);
  if (text === null) return fallback;
  try {
    const value = JSON.parse(text) as T | null;
    return value === null || value === undefined ? fallback : value;
  } catch {
    return fallback;
  }
}

export function saveJson(key: string, value: unknown): boolean {
  try {
    return saveText(key, JSON.stringify(value));
  } catch {
    return false;
  }
}

/** Demande au navigateur de ne pas évincer les données (navigator.storage.persist), sans jamais échouer. */
export async function requestPersistence(): Promise<boolean> {
  try {
    if (typeof navigator === 'undefined' || !navigator.storage?.persist) return false;
    if (navigator.storage.persisted && (await navigator.storage.persisted())) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}
