/**
 * Persistance dans le navigateur (localStorage). Toutes les fonctions sont sûres :
 * elles n'échouent jamais (stockage indisponible, quota dépassé, JSON corrompu → valeur par défaut / `false`).
 */

/** Clés utilisées (préfixe `bacchus.`). */
export const STORAGE_KEYS = {
  /** Copie de travail de la cave, au format CSV. */
  csv: 'bacchus.cave.csv',
  /** Métadonnées de la copie de travail (JSON). */
  meta: 'bacchus.cave.meta',
  /** Réglages IA (JSON `AiSettings`). */
  ai: 'bacchus.ai.settings',
  /** Cache des fenêtres de dégustation obtenues par l'IA (JSON). */
  aiCache: 'bacchus.ai.cache',
  /** Préférences d'interface (JSON). */
  prefs: 'bacchus.prefs',
  /** Session de réorganisation guidée en cours (JSON). */
  reorg: 'bacchus.reorg.session',
} as const;

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
    return storage()?.getItem(key) ?? null;
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
    return true;
  } catch {
    return false;
  }
}

export function removeKey(key: string): void {
  try {
    storage()?.removeItem(key);
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
