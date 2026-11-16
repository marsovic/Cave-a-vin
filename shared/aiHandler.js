// @ts-check
/**
 * Logique de la fonction serveur `/api/ai` (proxy vers Groq), indépendante de
 * l'hébergeur : elle reçoit une `Request` Web, les variables d'environnement et une
 * fonction `fetch`, et renvoie une `Response`. Utilisée par `api/ai.js` (Vercel) et par
 * `scripts/devApiPlugin.ts` (serveur de développement Vite) ; testée dans `src/ai/`.
 *
 * Types : voir `aiHandler.d.ts` (écrit à la main).
 */
import { GROQ_URL, buildGroqBody, mapGroqError, parseGroqResponse, resolveModels, validateAiRequest } from './groq.js';

/** Taille maximale du corps accepté (Vercel plafonne à 4,5 Mo). */
export const MAX_BODY_BYTES = 4 * 1024 * 1024;
/** Délai accordé à Groq (la fonction Vercel est limitée à 60 s). */
export const UPSTREAM_TIMEOUT_MS = 55_000;
/** En-tête portant le code d'accès du déploiement. */
export const ACCESS_CODE_HEADER = 'x-bacchus-code';

function jsonResponse(status, payload, extraHeaders) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      ...extraHeaders,
    },
  });
}

function errorResponse(status, code, message, extraHeaders) {
  return jsonResponse(status, { error: { code, message } }, extraHeaders);
}

function envValue(env, name) {
  const raw = env ? env[name] : undefined;
  return typeof raw === 'string' ? raw.trim() : '';
}

/** Comparaison de chaînes en temps constant (ne s'arrête pas au premier caractère différent). */
export function timingSafeEqualStrings(a, b) {
  const length = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < length; i++) {
    diff |= (i < a.length ? a.charCodeAt(i) : 0) ^ (i < b.length ? b.charCodeAt(i) : 0);
  }
  return diff === 0;
}

/** `true` si la requête ne porte pas d'en-tête Origin, ou si son hôte est celui du site. */
function isSameOrigin(request) {
  const origin = request.headers.get('origin');
  if (origin === null) return true;
  let originHost;
  try {
    originHost = new URL(origin).host.toLowerCase();
  } catch {
    return false;
  }
  const forwarded = request.headers.get('x-forwarded-host');
  let host = ((forwarded ? forwarded.split(',')[0] : request.headers.get('host')) ?? '').trim().toLowerCase();
  if (!host) {
    try {
      host = new URL(request.url).host.toLowerCase();
    } catch {
      return false;
    }
  }
  return originHost !== '' && originHost === host;
}

/* ---------- Limitation de débit (au mieux : en mémoire, par instance du serveur) ---------- */

const RATE_WINDOW_MS = 60_000;
/** Requêtes IA par minute et par adresse : large pour un usage normal (une analyse = quelques lots). */
const RATE_MAX_POSTS = 40;
const CODE_WINDOW_MS = 10 * 60_000;
/** Codes d'accès erronés tolérés par adresse sur dix minutes (contre l'essai systématique). */
const CODE_MAX_FAILURES = 8;
const counters = new Map();

function clientAddress(request) {
  const forwarded = request.headers.get('x-real-ip') ?? request.headers.get('x-forwarded-for') ?? '';
  return (forwarded.split(',')[0] ?? '').trim();
}

/** Secondes à attendre si la limite est dépassée, sinon 0. Sans adresse connue : pas de limite. */
function overLimit(bucket, request, max, windowMs, count = true) {
  const address = clientAddress(request);
  if (!address) return 0;
  const id = `${bucket}:${address}`;
  const now = Date.now();
  let entry = counters.get(id);
  if (!entry || now >= entry.reset) {
    if (!count) return 0;
    if (counters.size > 5000) counters.clear();
    entry = { count: 0, reset: now + windowMs };
    counters.set(id, entry);
  }
  if (count) entry.count += 1;
  return entry.count > max ? Math.max(1, Math.ceil((entry.reset - now) / 1000)) : 0;
}

/** Tests : remet les compteurs à zéro. */
export function resetRateLimits() {
  counters.clear();
}

function tooManyResponse(seconds, message) {
  return jsonResponse(429, { error: { code: 'quota', message, retryAfter: seconds } }, { 'retry-after': String(seconds) });
}

function codeMatches(request, expected) {
  const given = (request.headers.get(ACCESS_CODE_HEADER) ?? '').trim();
  return timingSafeEqualStrings(given, expected);
}

function modelsFromEnv(env) {
  return resolveModels({
    texte: envValue(env, 'GROQ_MODEL_TEXT'),
    vision: envValue(env, 'GROQ_MODEL_VISION'),
    web: envValue(env, 'GROQ_MODEL_WEB'),
  });
}

async function handlePost(request, env, fetchImpl, options) {
  // (a) Même origine : un autre site ne doit pas pouvoir consommer la clé du serveur. Un navigateur
  // envoie toujours Origin avec un POST ; sans cet en-tête (script, curl), seul un code d'accès
  // valide ouvre le relais.
  const accessCode = envValue(env, 'APP_ACCESS_CODE');
  const hasOrigin = request.headers.get('origin') !== null;
  if (hasOrigin ? !isSameOrigin(request) : !(accessCode && codeMatches(request, accessCode))) {
    return errorResponse(403, 'indisponible', 'Requête refusée : elle ne provient pas de l\'application.');
  }

  // (b) Code d'accès du déploiement.
  const blocked = overLimit('code', request, CODE_MAX_FAILURES, CODE_WINDOW_MS, false);
  if (accessCode && blocked) {
    return tooManyResponse(blocked, 'Trop de codes d\'accès erronés. Réessayez dans quelques minutes.');
  }
  if (accessCode && !codeMatches(request, accessCode)) {
    overLimit('code', request, CODE_MAX_FAILURES, CODE_WINDOW_MS);
    const given = (request.headers.get(ACCESS_CODE_HEADER) ?? '').trim();
    return errorResponse(
      401,
      'code-acces',
      given
        ? 'Code d\'accès refusé : vérifiez-le dans les réglages de l\'assistant IA.'
        : 'Ce serveur demande un code d\'accès : saisissez-le dans les réglages de l\'assistant IA.',
    );
  }

  const wait = overLimit('post', request, RATE_MAX_POSTS, RATE_WINDOW_MS);
  if (wait) return tooManyResponse(wait, 'Trop de demandes à l\'assistant IA en peu de temps. Réessayez dans un instant.');

  // (c) Clé Groq du serveur.
  const apiKey = envValue(env, 'GROQ_API_KEY');
  if (!apiKey) {
    return errorResponse(
      503,
      'indisponible',
      'L\'assistant IA n\'est pas configuré sur ce serveur (variable GROQ_API_KEY absente).',
    );
  }

  // (d) Corps de la requête.
  const tooLarge = () =>
    errorResponse(413, 'trop-volumineux', 'Demande trop volumineuse (4 Mo au plus) : réduisez la photo.');
  const declared = Number(request.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return tooLarge();
  let text;
  try {
    text = await request.text();
  } catch {
    return errorResponse(400, 'reponse-invalide', 'Requête IA illisible.');
  }
  if (text.length > MAX_BODY_BYTES) return tooLarge();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return errorResponse(400, 'reponse-invalide', 'Requête IA invalide : JSON attendu.');
  }

  // (e) Validation : seuls les champs connus sont transmis, jamais de modèle choisi par le client.
  const checked = validateAiRequest(body);
  if (!checked.ok) return errorResponse(400, 'reponse-invalide', checked.message);
  const aiRequest = checked.value;

  // (f) Modèles.
  const models = modelsFromEnv(env);

  // (g) Appel de Groq.
  const timeoutMs = options && typeof options.timeoutMs === 'number' ? options.timeoutMs : UPSTREAM_TIMEOUT_MS;
  const log = options && typeof options.log === 'function' ? options.log : null;
  let upstream;
  let raw;
  try {
    upstream = await fetchImpl(GROQ_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify(buildGroqBody(aiRequest, models)),
      // Délai de garde, et abandon si le navigateur a annulé sa demande.
      signal:
        request.signal && typeof AbortSignal.any === 'function'
          ? AbortSignal.any([request.signal, AbortSignal.timeout(timeoutMs)])
          : AbortSignal.timeout(timeoutMs),
    });
    raw = await upstream.text();
  } catch (error) {
    const name = error && typeof error === 'object' && 'name' in error ? error.name : '';
    if (name === 'TimeoutError' || name === 'AbortError') {
      if (log) log(`[api/ai] Groq n'a pas répondu en ${timeoutMs} ms (rôle ${aiRequest.role})`);
      return errorResponse(504, 'indisponible', 'L\'IA n\'a pas répondu à temps. Réessayez dans quelques instants.');
    }
    if (log) log(`[api/ai] Groq injoignable (rôle ${aiRequest.role})`);
    return errorResponse(
      502,
      'indisponible',
      'Le serveur n\'a pas pu joindre le service Groq. Réessayez dans quelques instants.',
    );
  }

  let data = null;
  try {
    data = JSON.parse(raw);
  } catch {
    data = null;
  }

  // (h) Réponse.
  if (!upstream.ok) {
    const mapped = mapGroqError(
      upstream.status,
      data,
      upstream.headers.get('retry-after'),
      'serveur',
      models,
      aiRequest.role,
    );
    if (log) log(`[api/ai] Groq a répondu ${upstream.status} (rôle ${aiRequest.role}, modèle ${models[aiRequest.role]}) → ${mapped.code}`);
    const error = { code: mapped.code, message: mapped.message };
    if (mapped.retryAfter !== undefined) error.retryAfter = mapped.retryAfter;
    return jsonResponse(
      mapped.status,
      { error },
      mapped.retryAfter !== undefined ? { 'retry-after': String(mapped.retryAfter) } : undefined,
    );
  }

  let parsed;
  try {
    parsed = parseGroqResponse(data, aiRequest.role);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'L\'IA a renvoyé une réponse vide. Réessayez.';
    return errorResponse(502, 'reponse-invalide', message);
  }
  return jsonResponse(200, {
    content: parsed.content,
    modele: parsed.modele || models[aiRequest.role],
    web: parsed.web,
  });
}

/**
 * Traite une requête adressée à `/api/ai`.
 *  - GET  → état du service : `{ configured, codeRequired, codeOk, models }` ;
 *  - POST → relaie une requête IA validée vers Groq : `{ content, modele, web }`
 *           ou `{ error: { code, message, retryAfter? } }`.
 */
export async function handleAiRequest(request, env, fetchImpl = fetch, options) {
  try {
    if (request.method === 'GET') {
      const accessCode = envValue(env, 'APP_ACCESS_CODE');
      const given = (request.headers.get(ACCESS_CODE_HEADER) ?? '').trim();
      // Un code erroné compte comme un essai ; au-delà de la limite, plus aucune vérification.
      let codeOk = accessCode === '';
      if (accessCode && !overLimit('code', request, CODE_MAX_FAILURES, CODE_WINDOW_MS, false)) {
        codeOk = codeMatches(request, accessCode);
        if (!codeOk && given) overLimit('code', request, CODE_MAX_FAILURES, CODE_WINDOW_MS);
      }
      return jsonResponse(200, {
        configured: envValue(env, 'GROQ_API_KEY') !== '',
        codeRequired: accessCode !== '',
        // Permet à l'interface de signaler tout de suite un code d'accès absent ou erroné.
        codeOk,
        models: modelsFromEnv(env),
      });
    }
    if (request.method === 'POST') {
      return await handlePost(request, env, fetchImpl, options);
    }
    return errorResponse(405, 'indisponible', 'Méthode non autorisée.', { allow: 'GET, POST' });
  } catch {
    return errorResponse(500, 'indisponible', 'Erreur interne de l\'assistant IA. Réessayez dans quelques instants.');
  }
}
