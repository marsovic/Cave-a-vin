/**
 * Types de `shared/aiHandler.js` (écrits à la main : à tenir à jour avec le module).
 */
import type { AiErrorCode, AiModels } from './groq.js';

/** Variables d'environnement lues : GROQ_API_KEY, APP_ACCESS_CODE, GROQ_MODEL_TEXT / _VISION / _WEB. */
export type AiHandlerEnv = Readonly<Record<string, string | undefined>>;

/** Sous-ensemble de `fetch` utilisé pour appeler Groq (le `fetch` global convient). */
export type AiFetch = (
  url: string,
  init: { method: 'POST'; headers: Record<string, string>; body: string; signal: AbortSignal },
) => Promise<Response>;

export interface AiHandlerOptions {
  /** Délai accordé à Groq, en millisecondes (55 000 par défaut). */
  timeoutMs?: number;
  /** Journal des échecs amont (jamais de clé ni de contenu de requête). */
  log?: (message: string) => void;
}

/** Corps de la réponse à `GET /api/ai`. */
export interface AiServerStatus {
  /** La variable GROQ_API_KEY est renseignée. */
  configured: boolean;
  /** La variable APP_ACCESS_CODE est renseignée. */
  codeRequired: boolean;
  /** Aucun code exigé, ou en-tête `x-bacchus-code` correct. */
  codeOk: boolean;
  models: AiModels;
}

/** Corps d'une réponse d'erreur de `/api/ai`. */
export interface AiServerError {
  error: { code: AiErrorCode; message: string; retryAfter?: number };
}

export declare const MAX_BODY_BYTES: number;
export declare const UPSTREAM_TIMEOUT_MS: number;
export declare const ACCESS_CODE_HEADER: 'x-bacchus-code';

/** Comparaison de chaînes en temps constant. */
export declare function timingSafeEqualStrings(a: string, b: string): boolean;

/**
 * Traite une requête adressée à `/api/ai` (GET : état ; POST : relais vers Groq ;
 * autres méthodes : 405). Ne lève jamais d'exception.
 */
export declare function handleAiRequest(
  request: Request,
  env: AiHandlerEnv,
  fetchImpl?: AiFetch,
  options?: AiHandlerOptions,
): Promise<Response>;
