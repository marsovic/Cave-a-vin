import type { Pairing } from '../domain/advisor';
import type { DrinkWindow, WineFields } from '../domain/types';
import type { AiSettings, ScanResult } from './types';

/**
 * Prépare une photo pour l'envoi au modèle de vision : correction de l'orientation,
 * réduction (plus grand côté <= `maxSide` px), encodage JPEG ; renvoie une data URL.
 */
export async function prepareImage(image: Blob, maxSide?: number): Promise<string> {
  void image; void maxSide;
  throw new Error('non implémenté');
}

/** Lit une étiquette de bouteille (photo) et renvoie les champs du formulaire reconnus. */
export async function scanLabel(image: Blob, settings: AiSettings, signal?: AbortSignal): Promise<ScanResult> {
  void image; void settings; void signal;
  throw new Error('non implémenté');
}

/**
 * Demande à l'IA la fenêtre de dégustation de chaque vin (millésimés uniquement).
 * Résultat indexé par `wineKey`. Les vins pour lesquels l'IA ne répond pas sont absents
 * (l'appelant retombe sur l'estimation locale). Traite les vins par lots.
 * `onProgress(faits, total)` est appelé après chaque lot.
 */
export async function fetchDrinkWindows(
  wines: readonly WineFields[],
  year: number,
  settings: AiSettings,
  opts?: { signal?: AbortSignal; onProgress?: (done: number, total: number) => void },
): Promise<Map<string, DrinkWindow>> {
  void wines; void year; void settings; void opts;
  throw new Error('non implémenté');
}

/**
 * Demande à l'IA de noter l'accord de chaque vin avec un plat (0–100 + justification).
 * Résultat indexé par `wineKey` ; vins sans réponse absents.
 */
export async function fetchPairings(
  plat: string,
  wines: readonly WineFields[],
  year: number,
  settings: AiSettings,
  opts?: { signal?: AbortSignal; onProgress?: (done: number, total: number) => void },
): Promise<Map<string, Pairing>> {
  void plat; void wines; void year; void settings; void opts;
  throw new Error('non implémenté');
}
