import type { AiRequest, AiResponse, AiSettings, AiStatus } from './types';

/**
 * Détermine si l'IA est utilisable : réglage `desactivee`, clé personnelle présente,
 * sinon interrogation de `GET /api/ai` (résultat mis en cache quelques minutes).
 * Ne lève jamais d'exception : en cas d'échec réseau, renvoie `disponible: false`.
 */
export async function getAiStatus(settings: AiSettings, signal?: AbortSignal): Promise<AiStatus> {
  void settings; void signal;
  throw new Error('non implémenté');
}

/**
 * Envoie une requête à l'IA : directement à l'API Groq si `settings.cleGroq` est renseignée,
 * sinon via `POST /api/ai`. Lève une `AiError` (message français) en cas d'échec.
 */
export async function aiComplete(req: AiRequest, settings: AiSettings, signal?: AbortSignal): Promise<AiResponse> {
  void req; void settings; void signal;
  throw new Error('non implémenté');
}
