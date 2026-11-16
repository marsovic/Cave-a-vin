import { GROQ_URL, buildGroqBody, mapGroqError, parseGroqResponse, resolveModels, validateAiRequest } from '../../shared/groq.js';
import type { ValidAiRequest } from '../../shared/groq.js';
import { AiError } from './types';
import type { AiErrorCode, AiRequest, AiResponse, AiSettings, AiStatus } from './types';

/** Adresse de la fonction serveur (même origine que l'application). */
export const AI_ENDPOINT = '/api/ai';
/** En-tête portant le code d'accès du déploiement (jamais envoyé à Groq). */
export const ACCESS_CODE_HEADER = 'x-dumbcellar-code';

/** Délai maximal d'une tentative. */
const REQUEST_TIMEOUT_MS = 60_000;
/** Délai maximal de l'interrogation de l'état du serveur. */
const STATUS_TIMEOUT_MS = 8_000;
/** Durée de validité de l'état du serveur gardé en mémoire. */
const STATUS_CACHE_MS = 5 * 60_000;
/** Attentes avant le 1er puis le 2e réessai. */
const BACKOFF_MS = [2_000, 4_000] as const;
/** Au-delà de ce délai (secondes) annoncé par un quota dépassé, on n'attend pas : on échoue tout de suite. */
const MAX_QUOTA_WAIT_S = 20;

const ERROR_CODES: readonly AiErrorCode[] = [
  'desactivee',
  'indisponible',
  'cle-invalide',
  'code-acces',
  'quota',
  'trop-volumineux',
  'reseau',
  'annule',
  'reponse-invalide',
];

/** Dépendances remplaçables dans les tests (réseau, attente, horloge, délais). */
export interface AiClientDeps {
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  /** Attente entre deux tentatives ; doit rejeter si `signal` est annulé. */
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  now: () => number;
  /** Délai maximal d'une tentative (ms). */
  timeoutMs: number;
  /** Délai maximal de `GET /api/ai` (ms). */
  statusTimeoutMs: number;
}

function cancelled(): AiError {
  return new AiError('annule', 'Demande annulée.');
}

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(cancelled());
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(cancelled());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

const DEFAULT_DEPS: AiClientDeps = {
  fetch: (url, init) => globalThis.fetch(url, init),
  sleep: defaultSleep,
  now: () => Date.now(),
  timeoutMs: REQUEST_TIMEOUT_MS,
  statusTimeoutMs: STATUS_TIMEOUT_MS,
};

let deps: AiClientDeps = { ...DEFAULT_DEPS };

/**
 * Remplace des dépendances du client (tests : faux `fetch`, attente instantanée…).
 * Renvoie une fonction qui rétablit les dépendances précédentes.
 */
export function setAiClientDeps(overrides: Partial<AiClientDeps>): () => void {
  const previous = deps;
  deps = { ...deps, ...overrides };
  return () => {
    deps = previous;
  };
}

/* ------------------------------------------------------------------ */
/* Envoi d'une requête HTTP avec délai maximal et annulation           */
/* ------------------------------------------------------------------ */

interface Reply {
  status: number;
  ok: boolean;
  text: string;
  retryAfter: string | null;
}

type Target = 'serveur' | 'groq';

async function send(
  url: string,
  init: RequestInit,
  signal: AbortSignal | undefined,
  timeoutMs: number,
  target: Target,
): Promise<Reply> {
  if (signal?.aborted) throw cancelled();
  const controller = new AbortController();
  let timedOut = false;
  const onAbort = (): void => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    const response = await deps.fetch(url, { ...init, signal: controller.signal });
    const text = await response.text();
    return { status: response.status, ok: response.ok, text, retryAfter: response.headers.get('retry-after') };
  } catch {
    if (signal?.aborted) throw cancelled();
    if (timedOut) {
      throw new AiError(
        'indisponible',
        `L'IA n'a pas répondu à temps (${Math.round(timeoutMs / 1000)} s). Réessayez dans quelques instants.`,
      );
    }
    throw new AiError(
      'reseau',
      target === 'groq'
        ? 'Connexion impossible au service Groq : vérifiez votre accès à internet puis réessayez.'
        : 'Connexion impossible : vérifiez votre accès à internet puis réessayez.',
    );
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isErrorCode(value: unknown): value is AiErrorCode {
  return typeof value === 'string' && (ERROR_CODES as readonly string[]).includes(value);
}

/** Un en-tête HTTP ne peut porter que des caractères ISO-8859-1 imprimables. */
function isHeaderSafe(value: string): boolean {
  return /^[\x20-\x7e\xa0-\xff]*$/.test(value);
}

/* ------------------------------------------------------------------ */
/* Une tentative, vers Groq ou vers la fonction serveur                */
/* ------------------------------------------------------------------ */

/**
 * Comportement après un échec :
 *  - `quota` : attendre le délai annoncé (s'il est court) puis réessayer ;
 *  - `transitoire` : jusqu'à 2 réessais (2 s puis 4 s) ;
 *  - `unique` : un seul réessai ;
 *  - `non` : échec immédiat.
 */
type RetryKind = 'quota' | 'transitoire' | 'unique' | 'non';

type Outcome = { ok: true; response: AiResponse } | { ok: false; error: AiError; retry: RetryKind };

function retryKindFor(status: number, code: AiErrorCode): RetryKind {
  if (status === 429) return 'quota';
  if (status === 422) return 'unique';
  if ((status === 500 || status === 502) && code === 'indisponible') return 'transitoire';
  return 'non';
}

/** Appel direct de l'API Groq avec la clé personnelle de l'utilisateur. */
async function callGroq(
  request: ValidAiRequest,
  key: string,
  settings: AiSettings,
  signal: AbortSignal | undefined,
): Promise<Outcome> {
  const models = resolveModels({
    texte: settings.modeleTexte,
    vision: settings.modeleVision,
    web: settings.modeleWeb,
  });
  const reply = await send(
    GROQ_URL,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(buildGroqBody(request, models)),
      credentials: 'omit',
      cache: 'no-store',
    },
    signal,
    deps.timeoutMs,
    'groq',
  );
  const data = parseJson(reply.text);
  if (!reply.ok) {
    const mapped = mapGroqError(reply.status, data ?? null, reply.retryAfter, 'cle-perso', models, request.role);
    return {
      ok: false,
      error: new AiError(mapped.code, mapped.message, mapped.retryAfter),
      // `mapped.status` ramène toutes les pannes amont (498, 5xx) à 502.
      retry: retryKindFor(mapped.status, mapped.code),
    };
  }
  try {
    const parsed = parseGroqResponse(data, request.role);
    return {
      ok: true,
      response: { content: parsed.content, modele: parsed.modele || models[request.role], web: parsed.web },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'L\'IA a renvoyé une réponse vide. Réessayez.';
    return { ok: false, error: new AiError('reponse-invalide', message), retry: 'non' };
  }
}

/** Appel de la fonction serveur `/api/ai`, qui détient la clé Groq du déploiement. */
async function callServer(
  request: ValidAiRequest,
  settings: AiSettings,
  signal: AbortSignal | undefined,
): Promise<Outcome> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' };
  const code = settings.codeAcces.trim();
  if (code) {
    if (!isHeaderSafe(code)) {
      return {
        ok: false,
        error: new AiError('code-acces', 'Le code d\'accès contient des caractères non pris en charge : vérifiez-le dans les réglages.'),
        retry: 'non',
      };
    }
    headers[ACCESS_CODE_HEADER] = code;
  }
  // La requête validée ne contient que le rôle, les messages et les options : ni clé, ni modèle.
  const reply = await send(
    AI_ENDPOINT,
    { method: 'POST', headers, body: JSON.stringify(request), cache: 'no-store' },
    signal,
    deps.timeoutMs,
    'serveur',
  );
  const data = parseJson(reply.text);

  if (reply.ok && isRecord(data) && typeof data.content === 'string' && data.content.trim() !== '') {
    return {
      ok: true,
      response: {
        content: data.content,
        modele: typeof data.modele === 'string' ? data.modele : '',
        web: data.web === true,
      },
    };
  }

  const serverError = isRecord(data) && isRecord(data.error) ? data.error : undefined;
  if (!reply.ok && serverError && isErrorCode(serverError.code) && typeof serverError.message === 'string') {
    const bodyDelay = serverError.retryAfter;
    const headerDelay = reply.retryAfter === null ? Number.NaN : Number(reply.retryAfter);
    const retryAfter =
      typeof bodyDelay === 'number' && Number.isFinite(bodyDelay) && bodyDelay > 0
        ? Math.ceil(bodyDelay)
        : Number.isFinite(headerDelay) && headerDelay > 0
          ? Math.ceil(headerDelay)
          : undefined;
    return {
      ok: false,
      error: new AiError(serverError.code, serverError.message, retryAfter),
      retry: retryKindFor(reply.status, serverError.code),
    };
  }

  // Réponse qui ne vient pas de notre fonction : page HTML d'un hébergeur sans /api, panne de la plateforme…
  if (reply.status >= 500) {
    return {
      ok: false,
      error: new AiError(
        'indisponible',
        `Le serveur de l'assistant IA a rencontré une erreur (${reply.status}). Réessayez dans quelques instants.`,
      ),
      retry: reply.status === 504 ? 'non' : 'transitoire',
    };
  }
  return {
    ok: false,
    error: new AiError(
      'indisponible',
      'L\'assistant IA n\'est pas disponible sur cet hébergement (la fonction /api/ai ne répond pas). Saisissez une clé Groq personnelle dans les réglages pour l\'utiliser.',
    ),
    retry: 'non',
  };
}

/** Attente avant le prochain essai (ms), ou `null` s'il ne faut pas réessayer. */
function retryDelay(error: AiError, retry: RetryKind, retriesDone: number): number | null {
  switch (retry) {
    case 'quota': {
      if (error.retryAfter !== undefined && error.retryAfter > MAX_QUOTA_WAIT_S) return null;
      const backoff = BACKOFF_MS[retriesDone];
      if (backoff === undefined) return null;
      return error.retryAfter !== undefined ? error.retryAfter * 1000 : backoff;
    }
    case 'transitoire':
      return BACKOFF_MS[retriesDone] ?? null;
    case 'unique':
      return retriesDone === 0 ? BACKOFF_MS[0] : null;
    case 'non':
      return null;
  }
}

/**
 * Envoie une requête à l'IA : directement à l'API Groq si `settings.cleGroq` est renseignée,
 * sinon via `POST /api/ai`. Lève une `AiError` (message français) en cas d'échec.
 *
 * Délai maximal de 60 s par tentative ; `signal` annule la demande (`AiError('annule')`).
 * Réessais automatiques : quota dépassé (429) si le délai annoncé est d'au plus 20 s, panne
 * passagère (5xx) — au plus 2 réessais, après 2 s puis 4 s — et erreur 422 (un réessai).
 */
export async function aiComplete(req: AiRequest, settings: AiSettings, signal?: AbortSignal): Promise<AiResponse> {
  if (settings.desactivee) {
    throw new AiError('desactivee', 'L\'assistant IA est désactivé dans les réglages.');
  }
  if (signal?.aborted) throw cancelled();

  const checked = validateAiRequest(req);
  if (!checked.ok) throw new AiError('reponse-invalide', checked.message);
  const request = checked.value;

  const key = settings.cleGroq.trim();
  if (key && !/^[\x21-\x7e]+$/.test(key)) {
    throw new AiError('cle-invalide', 'La clé Groq saisie dans les réglages contient des caractères invalides : vérifiez-la.');
  }

  for (let retriesDone = 0; ; retriesDone++) {
    const outcome = key ? await callGroq(request, key, settings, signal) : await callServer(request, settings, signal);
    if (outcome.ok) return outcome.response;
    const delay = retryDelay(outcome.error, outcome.retry, retriesDone);
    if (delay === null) {
      // L'état affiché (pastille) est sans doute périmé : il sera redemandé au serveur.
      const code = outcome.error.code;
      if (!key && (code === 'code-acces' || code === 'cle-invalide' || code === 'indisponible')) resetAiStatusCache();
      throw outcome.error;
    }
    await deps.sleep(delay, signal);
    if (signal?.aborted) throw cancelled();
  }
}

/* ------------------------------------------------------------------ */
/* État de l'assistant                                                 */
/* ------------------------------------------------------------------ */

let statusCache: { at: number; status: AiStatus } | null = null;
let statusSignature: string | null = null;

/** Oublie l'état du serveur gardé en mémoire (le prochain `getAiStatus` le redemandera). */
export function resetAiStatusCache(): void {
  statusCache = null;
  statusSignature = null;
}

const NO_SERVER_MESSAGE =
  'Assistant IA indisponible : la fonction serveur /api/ai ne répond pas. Saisissez une clé Groq personnelle dans les réglages pour l\'activer.';

async function fetchServerStatus(settings: AiSettings, signal?: AbortSignal): Promise<{ status: AiStatus; cacheable: boolean }> {
  const code = settings.codeAcces.trim();
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (code && isHeaderSafe(code)) headers[ACCESS_CODE_HEADER] = code;

  let reply: Reply;
  try {
    reply = await send(AI_ENDPOINT, { method: 'GET', headers, cache: 'no-store' }, signal, deps.statusTimeoutMs, 'serveur');
  } catch (error) {
    const annule = error instanceof AiError && error.code === 'annule';
    return {
      status: {
        disponible: false,
        mode: 'aucun',
        codeRequis: false,
        message: annule
          ? 'Vérification de l\'assistant IA annulée.'
          : 'Assistant IA injoignable : vérifiez votre connexion à internet.',
      },
      cacheable: false,
    };
  }

  const data = parseJson(reply.text);
  if (!reply.ok || !isRecord(data) || typeof data.configured !== 'boolean') {
    return {
      status: { disponible: false, mode: 'aucun', codeRequis: false, message: NO_SERVER_MESSAGE },
      // Un hébergement sans fonction serveur ne changera pas d'ici quelques minutes ; une panne (5xx), peut-être.
      cacheable: reply.status < 500,
    };
  }

  if (!data.configured) {
    return {
      status: {
        disponible: false,
        mode: 'aucun',
        codeRequis: false,
        message: 'Aucune clé Groq configurée : saisissez la vôtre dans les réglages de l\'assistant IA.',
      },
      cacheable: true,
    };
  }

  const codeRequired = data.codeRequired === true;
  // Un serveur qui n'indique pas `codeOk` : on suppose le code bon dès qu'il est saisi.
  const codeOk = !codeRequired || (typeof data.codeOk === 'boolean' ? data.codeOk : code !== '');
  if (!codeOk) {
    return {
      status: {
        disponible: false,
        mode: 'serveur',
        codeRequis: true,
        message: code
          ? 'Code d\'accès refusé : vérifiez-le dans les réglages de l\'assistant IA.'
          : 'Ce serveur demande un code d\'accès : saisissez-le dans les réglages de l\'assistant IA.',
      },
      cacheable: true,
    };
  }
  return {
    status: { disponible: true, mode: 'serveur', codeRequis: false, message: 'IA prête.' },
    cacheable: true,
  };
}

/**
 * Détermine si l'IA est utilisable : réglage `desactivee`, clé personnelle présente,
 * sinon interrogation de `GET /api/ai` (résultat mis en cache 5 minutes, oublié dès que
 * les réglages changent). Ne lève jamais d'exception : en cas d'échec réseau, renvoie
 * `disponible: false`.
 */
export async function getAiStatus(settings: AiSettings, signal?: AbortSignal): Promise<AiStatus> {
  try {
    const signature = JSON.stringify([settings.desactivee, settings.cleGroq.trim(), settings.codeAcces.trim()]);
    if (signature !== statusSignature) {
      statusCache = null;
      statusSignature = signature;
    }

    if (settings.desactivee) {
      return {
        disponible: false,
        mode: 'aucun',
        codeRequis: false,
        message: 'Assistant IA désactivé dans les réglages.',
      };
    }
    if (settings.cleGroq.trim()) {
      return { disponible: true, mode: 'cle-perso', codeRequis: false, message: 'IA prête (clé Groq personnelle).' };
    }

    if (statusCache && deps.now() - statusCache.at < STATUS_CACHE_MS) return statusCache.status;

    const { status, cacheable } = await fetchServerStatus(settings, signal);
    // Les réglages ont pu changer pendant l'attente : ne mémoriser que l'état qui leur correspond.
    if (cacheable && statusSignature === signature) statusCache = { at: deps.now(), status };
    return status;
  } catch {
    return {
      disponible: false,
      mode: 'aucun',
      codeRequis: false,
      message: 'Assistant IA indisponible pour le moment.',
    };
  }
}
