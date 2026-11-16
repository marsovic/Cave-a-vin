/**
 * Persistance dans le navigateur (localStorage). Toutes les fonctions sont sûres :
 * elles n'échouent jamais (stockage indisponible, quota dépassé, JSON corrompu → valeur par défaut / `false`).
 */

/** Clés utilisées (préfixe `bacchus.`). */
export const STORAGE_KEYS = {
  /** Copie de travail de la cave, au format CSV. */
  csv: 'bacchus.cave.csv',
  /** Métadonnées de la copie de travail (JSON `WorkingCopyMeta`). */
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

export interface WorkingCopyMeta {
  /** Date (ms epoch) de la dernière modification de la cave. */
  modifiedAt: number;
  /** Date (ms epoch) du dernier enregistrement dans un fichier / export, ou `null`. */
  exportedAt: number | null;
  /** Nom du dernier fichier ouvert / enregistré, ou `null`. */
  fileName: string | null;
}

export function loadText(key: string): string | null {
  void key;
  throw new Error('non implémenté');
}

/** Renvoie `false` si l'écriture a échoué (quota, navigation privée…). */
export function saveText(key: string, value: string): boolean {
  void key; void value;
  throw new Error('non implémenté');
}

export function removeKey(key: string): void {
  void key;
  throw new Error('non implémenté');
}

/** Lit du JSON ; renvoie `fallback` si absent ou illisible. */
export function loadJson<T>(key: string, fallback: T): T {
  void key; void fallback;
  throw new Error('non implémenté');
}

export function saveJson(key: string, value: unknown): boolean {
  void key; void value;
  throw new Error('non implémenté');
}

/** Demande au navigateur de ne pas évincer les données (navigator.storage.persist), sans jamais échouer. */
export async function requestPersistence(): Promise<boolean> {
  throw new Error('non implémenté');
}
