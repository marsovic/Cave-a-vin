// @ts-check
/**
 * Accès à l'API Groq — module JavaScript ESM PUR, partagé par la fonction serveur
 * (`api/ai.js`, via `shared/aiHandler.js`) et par le client navigateur (`src/ai/client.ts`).
 *
 * Aucune dépendance, aucun accès à `process`, `window` ou au réseau : uniquement la
 * validation des requêtes, la construction du corps envoyé à Groq, la lecture de sa
 * réponse et la traduction de ses erreurs en messages français.
 *
 * Les types sont décrits à la main dans `groq.d.ts` (à tenir à jour avec ce fichier).
 */

export const GROQ_BASE_URL = 'https://api.groq.com/openai/v1';
export const GROQ_URL = `${GROQ_BASE_URL}/chat/completions`;

/** Modèles par défaut (documentation Groq, novembre 2026). */
export const DEFAULT_MODELS = Object.freeze({
  texte: 'openai/gpt-oss-120b',
  vision: 'qwen/qwen3.8-27b',
  web: 'openai/gpt-oss-120b',
});

export const AI_ROLES = Object.freeze(['texte', 'vision', 'web']);

export const AI_LIMITS = Object.freeze({
  maxMessages: 6,
  maxTextChars: 24_000,
  maxParts: 8,
  maxImages: 2,
  /** Longueur maximale d'une data URL d'image (≈ 2,6 Mo d'image une fois décodée). */
  maxImageChars: 3_500_000,
  maxTokens: 8192,
  maxTemperature: 1.5,
  maxSchemaChars: 16_000,
});

/** Valeur par défaut de `max_completion_tokens` selon le rôle. */
export const DEFAULT_MAX_TOKENS = Object.freeze({ texte: 4096, vision: 1200, web: 4096 });
export const DEFAULT_TEMPERATURE = 0.2;

const MESSAGE_ROLES = ['system', 'user', 'assistant'];
const SCHEMA_NAME_RE = /^[a-zA-Z0-9_-]{1,64}$/;
const MODEL_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._\-/:@]{0,99}$/;
const IMAGE_PREFIX_RE = /^data:image\/(?:jpeg|png|webp);base64,/;
const BASE64_BODY_RE = /^[A-Za-z0-9+/]+={0,2}$/;
const CITATION_RE = /[ \t]*【[^】]*】/g;

/** Variable d'environnement du serveur qui choisit le modèle de chaque rôle. */
export const MODEL_ENV_VARS = Object.freeze({
  texte: 'GROQ_MODEL_TEXT',
  vision: 'GROQ_MODEL_VISION',
  web: 'GROQ_MODEL_WEB',
});

const ROLE_LABELS = { texte: 'texte', vision: 'vision', web: 'recherche web' };

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fail(message) {
  return { ok: false, message };
}

/**
 * Fusionne des identifiants de modèles facultatifs avec les modèles par défaut.
 * Les valeurs vides ou mal formées sont ignorées.
 */
export function resolveModels(overrides) {
  const out = { ...DEFAULT_MODELS };
  if (!isPlainObject(overrides)) return out;
  for (const role of AI_ROLES) {
    const raw = overrides[role];
    if (typeof raw !== 'string') continue;
    const id = raw.trim();
    if (id && MODEL_ID_RE.test(id)) out[role] = id;
  }
  return out;
}

function validateImageUrl(url) {
  if (typeof url !== 'string') return 'image absente';
  if (!IMAGE_PREFIX_RE.test(url)) {
    return 'les images doivent être fournies en data URL JPEG, PNG ou WebP (pas d\'adresse distante)';
  }
  if (url.length > AI_LIMITS.maxImageChars) return 'image trop lourde';
  const data = url.slice(url.indexOf(',') + 1);
  if (!data || !BASE64_BODY_RE.test(data)) return 'image mal encodée';
  return null;
}

/**
 * Valide et normalise le corps d'une requête IA (reçu du navigateur par le serveur, ou
 * construit par le client). Seuls les champs connus sont conservés.
 */
export function validateAiRequest(body) {
  if (!isPlainObject(body)) return fail('Requête IA invalide : objet JSON attendu.');

  const role = body.role;
  if (typeof role !== 'string' || !AI_ROLES.includes(role)) {
    return fail('Requête IA invalide : rôle inconnu (attendu : texte, vision ou web).');
  }

  const rawMessages = body.messages;
  if (!Array.isArray(rawMessages) || rawMessages.length < 1 || rawMessages.length > AI_LIMITS.maxMessages) {
    return fail(`Requête IA invalide : de 1 à ${AI_LIMITS.maxMessages} messages attendus.`);
  }

  let images = 0;
  const messages = [];
  for (let m = 0; m < rawMessages.length; m++) {
    const raw = rawMessages[m];
    const where = `message ${m + 1}`;
    if (!isPlainObject(raw)) return fail(`Requête IA invalide : ${where} mal formé.`);
    if (typeof raw.role !== 'string' || !MESSAGE_ROLES.includes(raw.role)) {
      return fail(`Requête IA invalide : ${where}, rôle inconnu.`);
    }
    const content = raw.content;
    if (typeof content === 'string') {
      if (!content.trim()) return fail(`Requête IA invalide : ${where} vide.`);
      if (content.length > AI_LIMITS.maxTextChars) return fail(`Requête IA invalide : ${where} trop long.`);
      messages.push({ role: raw.role, content });
      continue;
    }
    if (!Array.isArray(content) || content.length < 1 || content.length > AI_LIMITS.maxParts) {
      return fail(`Requête IA invalide : ${where}, contenu attendu (texte ou liste de 1 à ${AI_LIMITS.maxParts} éléments).`);
    }
    const parts = [];
    let textChars = 0;
    let messageImages = 0;
    for (const part of content) {
      if (!isPlainObject(part)) return fail(`Requête IA invalide : ${where}, élément mal formé.`);
      if (part.type === 'text') {
        if (typeof part.text !== 'string' || !part.text.trim()) {
          return fail(`Requête IA invalide : ${where}, texte vide.`);
        }
        textChars += part.text.length;
        if (textChars > AI_LIMITS.maxTextChars) return fail(`Requête IA invalide : ${where} trop long.`);
        parts.push({ type: 'text', text: part.text });
      } else if (part.type === 'image_url') {
        if (role !== 'vision') {
          return fail('Requête IA invalide : les images ne sont acceptées qu\'avec le rôle « vision ».');
        }
        if (raw.role !== 'user') {
          return fail('Requête IA invalide : les images ne sont acceptées que dans un message utilisateur.');
        }
        const url = isPlainObject(part.image_url) ? part.image_url.url : undefined;
        const problem = validateImageUrl(url);
        if (problem) return fail(`Requête IA invalide : ${problem}.`);
        images += 1;
        messageImages += 1;
        if (images > AI_LIMITS.maxImages) {
          return fail(`Requête IA invalide : au plus ${AI_LIMITS.maxImages} images par demande.`);
        }
        parts.push({ type: 'image_url', image_url: { url } });
      } else {
        return fail(`Requête IA invalide : ${where}, type d'élément inconnu.`);
      }
    }
    // Sans image, un texte simple est accepté par tous les modèles (y compris en message système).
    if (messageImages === 0) {
      messages.push({ role: raw.role, content: parts.map((p) => p.text).join('\n') });
    } else {
      messages.push({ role: raw.role, content: parts });
    }
  }

  let json = false;
  const rawJson = body.json;
  if (rawJson === true) {
    json = true;
  } else if (isPlainObject(rawJson)) {
    if (typeof rawJson.name !== 'string' || !SCHEMA_NAME_RE.test(rawJson.name)) {
      return fail('Requête IA invalide : nom de schéma JSON incorrect (lettres, chiffres, « _ » ou « - », 64 caractères au plus).');
    }
    if (!isPlainObject(rawJson.schema)) return fail('Requête IA invalide : schéma JSON absent.');
    let size = 0;
    try {
      size = JSON.stringify(rawJson.schema).length;
    } catch {
      return fail('Requête IA invalide : schéma JSON illisible.');
    }
    if (size > AI_LIMITS.maxSchemaChars) return fail('Requête IA invalide : schéma JSON trop volumineux.');
    json = { name: rawJson.name, schema: rawJson.schema };
  } else if (rawJson !== undefined && rawJson !== null && rawJson !== false) {
    return fail('Requête IA invalide : champ « json » incorrect.');
  }

  let maxTokens = DEFAULT_MAX_TOKENS[role];
  if (body.maxTokens !== undefined && body.maxTokens !== null) {
    const n = body.maxTokens;
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > AI_LIMITS.maxTokens) {
      return fail(`Requête IA invalide : maxTokens doit être un entier de 1 à ${AI_LIMITS.maxTokens}.`);
    }
    maxTokens = n;
  }

  let temperature = DEFAULT_TEMPERATURE;
  if (body.temperature !== undefined && body.temperature !== null) {
    const t = body.temperature;
    if (typeof t !== 'number' || !Number.isFinite(t) || t < 0 || t > AI_LIMITS.maxTemperature) {
      return fail(`Requête IA invalide : temperature doit être comprise entre 0 et ${AI_LIMITS.maxTemperature}.`);
    }
    temperature = t;
  }

  return { ok: true, value: { role, messages, json, maxTokens, temperature } };
}

function mentionsJson(messages) {
  for (const message of messages) {
    if (typeof message.content === 'string') {
      if (/json/i.test(message.content)) return true;
    } else {
      for (const part of message.content) {
        if (part.type === 'text' && /json/i.test(part.text)) return true;
      }
    }
  }
  return false;
}

/** Modèles qui acceptent `reasoning_effort` / `include_reasoning` et les sorties `json_schema` strictes. */
function isGptOss(model) {
  return /^openai\/gpt-oss/i.test(model);
}

function supportsStrictSchema(model) {
  return isGptOss(model) || model === DEFAULT_MODELS.texte || model === DEFAULT_MODELS.vision;
}

function responseFormat(json, model) {
  if (isPlainObject(json)) {
    // Schéma strict seulement pour les modèles connus pour le gérer ; sinon JSON simple
    // (le schéma est de toute façon décrit dans les consignes, et la réponse revalidée).
    if (!supportsStrictSchema(model)) return { type: 'json_object' };
    return { type: 'json_schema', json_schema: { name: json.name, strict: true, schema: json.schema } };
  }
  if (json === true) return { type: 'json_object' };
  return null;
}

/**
 * Construit le corps de la requête `POST /chat/completions` de Groq pour une requête
 * validée. Le modèle n'est JAMAIS choisi par l'appelant distant : il vient de `models`.
 */
export function buildGroqBody(request, models) {
  const role = request.role;
  const model = (models && models[role]) || DEFAULT_MODELS[role];
  const maxTokens = request.maxTokens ?? DEFAULT_MAX_TOKENS[role];
  let messages = request.messages;

  if (role === 'web') {
    // Recherche web intégrée : incompatible avec les sorties structurées → jamais de response_format.
    return {
      model,
      messages,
      tools: [{ type: 'browser_search' }],
      tool_choice: 'required',
      ...(isGptOss(model) ? { reasoning_effort: 'low' } : {}),
      max_completion_tokens: maxTokens,
    };
  }

  const format = responseFormat(request.json, model);
  if (format && format.type === 'json_object' && !mentionsJson(messages)) {
    // Le mode JSON simple de Groq exige le mot « JSON » dans les messages.
    messages = [{ role: 'system', content: 'Réponds uniquement avec un objet JSON valide.' }, ...messages];
  }

  const body = {
    model,
    messages,
    temperature: request.temperature ?? DEFAULT_TEMPERATURE,
    max_completion_tokens: maxTokens,
  };
  if (role === 'texte' && isGptOss(model)) {
    body.reasoning_effort = 'low';
    body.include_reasoning = false;
  }
  if (format) body.response_format = format;
  return body;
}

/** Retire les marqueurs de citation de la recherche web (« 【2†L6-L10】 »). */
export function stripCitations(text) {
  // L'espace qui précède un marqueur part avec lui ; la ponctuation française (« mot : ») est préservée.
  return text
    .replace(CITATION_RE, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

/**
 * Lit une réponse `chat/completions` réussie. Lève une `Error` (message français)
 * si elle ne contient pas de texte exploitable.
 */
export function parseGroqResponse(json, role) {
  const choice = isPlainObject(json) && Array.isArray(json.choices) ? json.choices[0] : undefined;
  const message = isPlainObject(choice) ? choice.message : undefined;
  const raw = isPlainObject(message) ? message.content : undefined;
  if (typeof raw !== 'string' || !raw.trim()) {
    if (isPlainObject(choice) && choice.finish_reason === 'length') {
      throw new Error('L\'IA a atteint sa limite de longueur avant de répondre. Réessayez.');
    }
    throw new Error('L\'IA a renvoyé une réponse vide. Réessayez.');
  }
  let web = false;
  if (role === 'web') {
    const tools = message.executed_tools;
    // tool_choice « required » impose la recherche ; une liste explicitement vide dit le contraire.
    web = Array.isArray(tools) ? tools.length > 0 : true;
  }
  const content = role === 'web' ? stripCitations(raw) : raw.trim();
  if (!content) throw new Error('L\'IA a renvoyé une réponse vide. Réessayez.');
  return {
    content,
    modele: typeof json.model === 'string' ? json.model : '',
    web,
  };
}

/** Délai lisible : « 12 s », « 3 min », « 2 h ». */
export function formatDelay(seconds) {
  const s = Math.max(1, Math.ceil(seconds));
  if (s < 90) return `${s} s`;
  if (s < 5400) return `${Math.round(s / 60)} min`;
  return `${Math.round(s / 3600)} h`;
}

/**
 * Délai avant nouvel essai (secondes entières ≥ 1) d'après l'en-tête `retry-after`
 * (secondes ou date HTTP) ou, à défaut, d'après le message de Groq
 * (« Please try again in 1m26.4s »). `undefined` si inconnu.
 */
export function parseRetryAfter(header, message) {
  if (typeof header === 'string' && header.trim()) {
    const text = header.trim();
    const n = Number(text);
    if (Number.isFinite(n) && n >= 0) return Math.max(1, Math.ceil(n));
    const date = Date.parse(text);
    if (Number.isFinite(date)) return Math.max(1, Math.ceil((date - Date.now()) / 1000));
  }
  if (typeof message === 'string') {
    const match = /try again in\s+((?:\d+(?:\.\d+)?(?:ms|h|m|s)\s*)+)/i.exec(message);
    if (match && match[1]) {
      let total = 0;
      for (const piece of match[1].matchAll(/(\d+(?:\.\d+)?)(ms|h|m|s)/g)) {
        const value = Number(piece[1]);
        const unit = piece[2];
        total += unit === 'h' ? value * 3600 : unit === 'm' ? value * 60 : unit === 'ms' ? value / 1000 : value;
      }
      if (total > 0) return Math.max(1, Math.ceil(total));
    }
  }
  return undefined;
}

function upstreamMessage(bodyJson) {
  const error = isPlainObject(bodyJson) ? bodyJson.error : undefined;
  const raw = isPlainObject(error) ? error.message : typeof error === 'string' ? error : undefined;
  if (typeof raw !== 'string') return '';
  // Jamais de clé dans un message renvoyé à l'utilisateur.
  const clean = raw.replace(/gsk_[A-Za-z0-9_-]+/g, 'gsk_…').replace(/\s+/g, ' ').trim();
  return clean.length > 200 ? `${clean.slice(0, 199)}…` : clean;
}

function upstreamCode(bodyJson) {
  const error = isPlainObject(bodyJson) ? bodyJson.error : undefined;
  return isPlainObject(error) && typeof error.code === 'string' ? error.code : '';
}

function modelProblem(models, role, contexte) {
  const resolved = models || DEFAULT_MODELS;
  if (typeof role === 'string' && AI_ROLES.includes(role)) {
    const name = resolved[role] || DEFAULT_MODELS[role];
    const how =
      contexte === 'serveur'
        ? `Indiquez un autre modèle dans la variable ${MODEL_ENV_VARS[role]} du serveur.`
        : `Indiquez un autre modèle (${ROLE_LABELS[role]}) dans les réglages de l'assistant IA, ou mettez l'application à jour.`;
    return `Le modèle « ${name} » n'est pas disponible chez Groq (retiré ou introuvable). ${how}`;
  }
  const how =
    contexte === 'serveur'
      ? 'Indiquez un autre modèle dans les variables GROQ_MODEL_TEXT, GROQ_MODEL_VISION ou GROQ_MODEL_WEB du serveur.'
      : 'Indiquez un autre modèle dans les réglages de l\'assistant IA, ou mettez l\'application à jour.';
  return `Le modèle demandé n'est pas disponible chez Groq (retiré ou introuvable). ${how}`;
}

/**
 * Traduit une réponse d'erreur de Groq en erreur de l'application : code, message
 * français actionnable, délai éventuel et statut HTTP que le serveur renvoie au client.
 *
 * Statuts renvoyés : 401 (clé), 404 (modèle), 413, 429, 422, 400, 502 (panne amont).
 */
export function mapGroqError(status, bodyJson, retryAfterHeader, contexte, models, role) {
  const detail = upstreamMessage(bodyJson);
  const code = upstreamCode(bodyJson);
  const lower = `${detail} ${code}`.toLowerCase();

  if (status === 401 || status === 403) {
    return {
      code: 'cle-invalide',
      status: 401,
      message:
        contexte === 'serveur'
          ? 'La clé Groq du serveur est refusée : vérifiez la variable GROQ_API_KEY.'
          : 'La clé Groq saisie dans les réglages est refusée : vérifiez-la ou créez-en une nouvelle sur console.groq.com.',
    };
  }

  if (
    status === 404 ||
    lower.includes('decommissioned') ||
    lower.includes('does not exist') ||
    lower.includes('model_not_found')
  ) {
    return { code: 'indisponible', status: 404, message: modelProblem(models, role, contexte) };
  }

  if (status === 413) {
    return {
      code: 'trop-volumineux',
      status: 413,
      message:
        'Demande trop volumineuse pour l\'IA (photo trop lourde, ou quota de tokens par minute dépassé). Réessayez dans une minute ou avec une photo plus légère.',
    };
  }

  if (status === 429) {
    const retryAfter = parseRetryAfter(retryAfterHeader, detail);
    const out = {
      code: 'quota',
      status: 429,
      message:
        retryAfter === undefined
          ? 'Quota de l\'IA atteint : réessayez dans quelques instants.'
          : `Quota de l'IA atteint : réessayez dans ${formatDelay(retryAfter)}.`,
    };
    if (retryAfter !== undefined) out.retryAfter = retryAfter;
    return out;
  }

  if (status === 498 || status >= 500) {
    return {
      code: 'indisponible',
      status: 502,
      message: `Le service Groq est momentanément indisponible (erreur ${status}). Réessayez dans quelques instants.`,
    };
  }

  if (status === 400 || status === 422) {
    return {
      code: 'reponse-invalide',
      status,
      message: detail
        ? `L'IA n'a pas pu produire de réponse exploitable (Groq : ${detail}). Réessayez.`
        : 'L\'IA n\'a pas pu produire de réponse exploitable. Réessayez.',
    };
  }

  return {
    code: 'indisponible',
    status: 502,
    message: `Réponse inattendue du service Groq (erreur ${status}). Réessayez dans quelques instants.`,
  };
}
