/**
 * Types de `shared/groq.js` (écrits à la main : à tenir à jour avec le module).
 * Structurellement compatibles avec ceux de `src/ai/types.ts`.
 */

export type AiRole = 'texte' | 'vision' | 'web';

export interface AiModels {
  texte: string;
  vision: string;
  web: string;
}

export type AiContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export interface AiMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | AiContentPart[];
}

/** Schéma JSON strict demandé au modèle (`response_format: json_schema`). */
export interface AiJsonSchema {
  /** Nom du schéma : `[a-zA-Z0-9_-]{1,64}`. */
  name: string;
  schema: Record<string, unknown>;
}

/** Requête acceptée par `buildGroqBody` (les champs absents prennent leur valeur par défaut). */
export interface AiRequestInput {
  role: AiRole;
  messages: readonly AiMessage[];
  json?: boolean | AiJsonSchema | undefined;
  maxTokens?: number | undefined;
  temperature?: number | undefined;
}

/** Requête validée et normalisée par `validateAiRequest`. */
export interface ValidAiRequest {
  role: AiRole;
  messages: AiMessage[];
  json: boolean | AiJsonSchema;
  maxTokens: number;
  temperature: number;
}

export type ValidationResult = { ok: true; value: ValidAiRequest } | { ok: false; message: string };

export type GroqResponseFormat =
  | { type: 'json_object' }
  | { type: 'json_schema'; json_schema: { name: string; strict: true; schema: Record<string, unknown> } };

/** Corps de `POST /chat/completions`. */
export interface GroqRequestBody {
  model: string;
  messages: AiMessage[];
  temperature?: number;
  max_completion_tokens: number;
  reasoning_effort?: 'low' | 'medium' | 'high';
  include_reasoning?: boolean;
  response_format?: GroqResponseFormat;
  tools?: { type: 'browser_search' }[];
  tool_choice?: 'required';
}

export interface ParsedGroqResponse {
  /** Texte de la réponse (marqueurs de citation retirés pour le rôle `web`). */
  content: string;
  /** Modèle annoncé par Groq (chaîne vide s'il est absent de la réponse). */
  modele: string;
  /** `true` si la recherche web a été utilisée. */
  web: boolean;
}

/** Identique à `AiErrorCode` de `src/ai/types.ts`. */
export type AiErrorCode =
  | 'desactivee'
  | 'indisponible'
  | 'cle-invalide'
  | 'code-acces'
  | 'quota'
  | 'trop-volumineux'
  | 'reseau'
  | 'annule'
  | 'reponse-invalide';

export type GroqErrorContext = 'serveur' | 'cle-perso';

export interface MappedGroqError {
  code: AiErrorCode;
  /** Message français, affichable tel quel. */
  message: string;
  /** Délai avant nouvel essai, en secondes (erreurs de quota). */
  retryAfter?: number;
  /** Statut HTTP que la fonction serveur renvoie au navigateur : 400, 401, 404, 413, 422, 429 ou 502. */
  status: number;
}

export declare const GROQ_BASE_URL: string;
export declare const GROQ_URL: string;
export declare const DEFAULT_MODELS: Readonly<AiModels>;
export declare const AI_ROLES: readonly AiRole[];
export declare const AI_LIMITS: Readonly<{
  maxMessages: number;
  maxTextChars: number;
  maxParts: number;
  maxImages: number;
  maxImageChars: number;
  maxTokens: number;
  maxTemperature: number;
  maxSchemaChars: number;
}>;
export declare const DEFAULT_MAX_TOKENS: Readonly<Record<AiRole, number>>;
export declare const DEFAULT_TEMPERATURE: number;
export declare const MODEL_ENV_VARS: Readonly<Record<AiRole, string>>;

/** Modèles par défaut, remplacés par les identifiants non vides et bien formés de `overrides`. */
export declare function resolveModels(
  overrides?: Partial<Record<AiRole, string | null | undefined>> | null,
): AiModels;

/** Valide et normalise une requête IA ; seuls les champs connus sont conservés. */
export declare function validateAiRequest(body: unknown): ValidationResult;

/** Corps de la requête Groq selon le rôle (jamais de `response_format` pour `web`). */
export declare function buildGroqBody(request: AiRequestInput, models?: Partial<AiModels> | null): GroqRequestBody;

/** Retire les marqueurs de citation « 【…】 » de la recherche web. */
export declare function stripCitations(text: string): string;

/** Lit une réponse réussie ; lève une `Error` (message français) si elle est vide. */
export declare function parseGroqResponse(json: unknown, role: AiRole): ParsedGroqResponse;

/** « 12 s », « 3 min », « 2 h ». */
export declare function formatDelay(seconds: number): string;

/** Délai avant nouvel essai (secondes entières ≥ 1), d'après l'en-tête ou le message de Groq. */
export declare function parseRetryAfter(header: string | null | undefined, message?: string | null): number | undefined;

/**
 * Traduit une erreur HTTP de Groq. `role`, facultatif, permet de nommer le modèle fautif
 * et le réglage à corriger.
 */
export declare function mapGroqError(
  status: number,
  bodyJson: unknown,
  retryAfterHeader: string | null | undefined,
  contexte: GroqErrorContext,
  models?: Partial<AiModels> | null,
  role?: AiRole,
): MappedGroqError;
