import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MODELS,
  GROQ_URL,
  buildGroqBody,
  formatDelay,
  mapGroqError,
  parseGroqResponse,
  parseRetryAfter,
  resolveModels,
  stripCitations,
  validateAiRequest,
} from '../../shared/groq.js';
import type { AiModels, ValidAiRequest } from '../../shared/groq.js';
import type { AiErrorCode, AiRequest } from './types';

const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBD';
const SCHEMA = {
  name: 'reponse',
  schema: { type: 'object', additionalProperties: false, required: ['a'], properties: { a: { type: 'string' } } },
};

function valid(body: unknown): ValidAiRequest {
  const result = validateAiRequest(body);
  if (!result.ok) throw new Error(`requête refusée : ${result.message}`);
  return result.value;
}

function refusal(body: unknown): string {
  const result = validateAiRequest(body);
  if (result.ok) throw new Error('requête acceptée à tort');
  return result.message;
}

describe('constantes', () => {
  it('pointe sur l\'API Groq et sur les modèles en production', () => {
    expect(GROQ_URL).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect(DEFAULT_MODELS).toEqual({
      texte: 'openai/gpt-oss-120b',
      vision: 'qwen/qwen3.8-27b',
      web: 'openai/gpt-oss-120b',
    });
  });

  it('n\'utilise aucun modèle retiré', () => {
    for (const model of Object.values(DEFAULT_MODELS)) {
      expect(model).not.toMatch(/compound|llama-3|llama-4|qwen3\.6|vision-preview/);
    }
  });
});

describe('resolveModels', () => {
  it('garde les modèles par défaut sans surcharge', () => {
    expect(resolveModels()).toEqual(DEFAULT_MODELS);
    expect(resolveModels({ texte: '', vision: '   ', web: undefined })).toEqual(DEFAULT_MODELS);
  });

  it('applique les surcharges bien formées et ignore les autres', () => {
    expect(resolveModels({ texte: ' openai/gpt-oss-20b ', vision: 'modèle avec espaces', web: null })).toEqual({
      ...DEFAULT_MODELS,
      texte: 'openai/gpt-oss-20b',
    });
  });
});

describe('validateAiRequest', () => {
  it('accepte une requête texte minimale et applique les valeurs par défaut', () => {
    expect(valid({ role: 'texte', messages: [{ role: 'user', content: 'Bonjour' }] })).toEqual({
      role: 'texte',
      messages: [{ role: 'user', content: 'Bonjour' }],
      json: false,
      maxTokens: 4096,
      temperature: 0.2,
    });
  });

  it('choisit le nombre de tokens par défaut selon le rôle', () => {
    const messages = [{ role: 'user', content: 'x' }];
    expect(valid({ role: 'vision', messages }).maxTokens).toBe(1200);
    expect(valid({ role: 'web', messages }).maxTokens).toBe(4096);
  });

  it('ne conserve que les champs connus (jamais de modèle ni de champ refusé par Groq)', () => {
    const value = valid({
      role: 'texte',
      model: 'autre/modele',
      logprobs: true,
      messages: [{ role: 'user', content: 'x', name: 'pirate' }],
      json: true,
      maxTokens: 500,
      temperature: 1,
    });
    expect(value).toEqual({
      role: 'texte',
      messages: [{ role: 'user', content: 'x' }],
      json: true,
      maxTokens: 500,
      temperature: 1,
    });
  });

  it('accepte un schéma JSON nommé', () => {
    expect(valid({ role: 'texte', messages: [{ role: 'user', content: 'x' }], json: SCHEMA }).json).toEqual(SCHEMA);
  });

  it('accepte une image en data URL avec le rôle vision', () => {
    const value = valid({
      role: 'vision',
      messages: [
        { role: 'system', content: [{ type: 'text', text: 'Tu lis des étiquettes.' }] },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Lis ceci' },
            { type: 'image_url', image_url: { url: JPEG, detail: 'high' } },
          ],
        },
      ],
    });
    // Un message sans image est ramené à un simple texte (seul format admis pour « system »).
    expect(value.messages[0]).toEqual({ role: 'system', content: 'Tu lis des étiquettes.' });
    expect(value.messages[1]).toEqual({
      role: 'user',
      content: [
        { type: 'text', text: 'Lis ceci' },
        { type: 'image_url', image_url: { url: JPEG } },
      ],
    });
  });

  it('accepte les formats PNG et WebP', () => {
    for (const type of ['png', 'webp']) {
      const url = `data:image/${type};base64,AAAA`;
      expect(
        validateAiRequest({
          role: 'vision',
          messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url } }] }],
        }).ok,
      ).toBe(true);
    }
  });

  it('refuse un corps qui n\'est pas un objet', () => {
    for (const body of [null, 'texte', 12, [], undefined]) {
      expect(refusal(body)).toMatch(/Requête IA invalide/);
    }
  });

  it('refuse un rôle inconnu', () => {
    expect(refusal({ role: 'audio', messages: [{ role: 'user', content: 'x' }] })).toMatch(/rôle inconnu/);
    expect(refusal({ messages: [{ role: 'user', content: 'x' }] })).toMatch(/rôle inconnu/);
  });

  it('refuse 0 ou plus de 12 messages', () => {
    expect(refusal({ role: 'texte', messages: [] })).toMatch(/1 à 12 messages/);
    expect(refusal({ role: 'texte' })).toMatch(/1 à 12 messages/);
    const many = Array.from({ length: 13 }, () => ({ role: 'user', content: 'x' }));
    expect(refusal({ role: 'texte', messages: many })).toMatch(/1 à 12 messages/);
    expect(validateAiRequest({ role: 'texte', messages: many.slice(0, 12) }).ok).toBe(true);
  });

  it('refuse un rôle de message inconnu, un message vide ou trop long', () => {
    expect(refusal({ role: 'texte', messages: [{ role: 'tool', content: 'x' }] })).toMatch(/rôle inconnu/);
    expect(refusal({ role: 'texte', messages: [{ role: 'user', content: '   ' }] })).toMatch(/vide/);
    expect(refusal({ role: 'texte', messages: [{ role: 'user', content: 12 }] })).toMatch(/contenu attendu/);
    expect(refusal({ role: 'texte', messages: [{ role: 'user', content: 'x'.repeat(24_001) }] })).toMatch(/trop long/);
    expect(validateAiRequest({ role: 'texte', messages: [{ role: 'user', content: 'x'.repeat(24_000) }] }).ok).toBe(true);
  });

  it('refuse une image distante', () => {
    for (const url of ['https://exemple.test/photo.jpg', 'http://exemple.test/a.png', '//exemple.test/a.png']) {
      expect(
        refusal({ role: 'vision', messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url } }] }] }),
      ).toMatch(/data URL/);
    }
  });

  it('refuse les data URL d\'un autre type ou mal encodées', () => {
    const attempt = (url: unknown): string =>
      refusal({ role: 'vision', messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url } }] }] });
    expect(attempt('data:image/svg+xml;base64,AAAA')).toMatch(/data URL/);
    expect(attempt('data:text/html;base64,AAAA')).toMatch(/data URL/);
    expect(attempt('data:image/jpeg;base64,')).toMatch(/mal encodée/);
    expect(attempt('data:image/jpeg;base64,AA AA<script>')).toMatch(/mal encodée/);
    expect(attempt(undefined)).toMatch(/image absente/);
  });

  it('refuse plus de 2 images', () => {
    const image = { type: 'image_url', image_url: { url: JPEG } };
    expect(refusal({ role: 'vision', messages: [{ role: 'user', content: [image, image, image] }] })).toMatch(
      /au plus 2 images/,
    );
    expect(
      refusal({
        role: 'vision',
        messages: [
          { role: 'user', content: [image, image] },
          { role: 'user', content: [image] },
        ],
      }),
    ).toMatch(/au plus 2 images/);
    expect(validateAiRequest({ role: 'vision', messages: [{ role: 'user', content: [image, image] }] }).ok).toBe(true);
  });

  it('refuse une image hors du rôle vision ou hors d\'un message utilisateur', () => {
    const content = [{ type: 'image_url', image_url: { url: JPEG } }];
    expect(refusal({ role: 'texte', messages: [{ role: 'user', content }] })).toMatch(/rôle « vision »/);
    expect(refusal({ role: 'web', messages: [{ role: 'user', content }] })).toMatch(/rôle « vision »/);
    expect(refusal({ role: 'vision', messages: [{ role: 'system', content }] })).toMatch(/message utilisateur/);
  });

  it('refuse un type d\'élément inconnu', () => {
    expect(
      refusal({ role: 'vision', messages: [{ role: 'user', content: [{ type: 'input_audio', data: 'x' }] }] }),
    ).toMatch(/type d'élément inconnu/);
  });

  it('refuse un schéma JSON mal nommé ou absent', () => {
    const messages = [{ role: 'user', content: 'x' }];
    expect(refusal({ role: 'texte', messages, json: { name: 'nom avec espace', schema: {} } })).toMatch(/nom de schéma/);
    expect(refusal({ role: 'texte', messages, json: { name: 'x'.repeat(65), schema: {} } })).toMatch(/nom de schéma/);
    expect(refusal({ role: 'texte', messages, json: { name: 'ok' } })).toMatch(/schéma JSON absent/);
    expect(refusal({ role: 'texte', messages, json: 'oui' })).toMatch(/champ « json »/);
  });

  it('refuse maxTokens et temperature hors bornes', () => {
    const messages = [{ role: 'user', content: 'x' }];
    for (const maxTokens of [0, -1, 8193, 1.5, '100']) {
      expect(refusal({ role: 'texte', messages, maxTokens })).toMatch(/maxTokens/);
    }
    expect(valid({ role: 'texte', messages, maxTokens: 8192 }).maxTokens).toBe(8192);
    for (const temperature of [-0.1, 1.6, Number.NaN, '0.5']) {
      expect(refusal({ role: 'texte', messages, temperature })).toMatch(/temperature/);
    }
    expect(valid({ role: 'texte', messages, temperature: 1.5 }).temperature).toBe(1.5);
    expect(valid({ role: 'texte', messages, temperature: 0 }).temperature).toBe(0);
  });

  it('accepte telle quelle une requête typée de l\'application', () => {
    const request: AiRequest = { role: 'texte', messages: [{ role: 'user', content: 'x' }], json: SCHEMA };
    expect(validateAiRequest(request).ok).toBe(true);
  });
});

describe('buildGroqBody', () => {
  const messages = [
    { role: 'system' as const, content: 'Réponds en JSON.' },
    { role: 'user' as const, content: 'Bonjour' },
  ];
  const models: AiModels = { texte: 'm-texte', vision: 'm-vision', web: 'm-web' };

  it('rôle texte : champs exacts, valeurs par défaut', () => {
    expect(buildGroqBody({ role: 'texte', messages }, models)).toEqual({
      model: 'm-texte',
      messages,
      temperature: 0.2,
      max_completion_tokens: 4096,
      reasoning_effort: 'low',
      include_reasoning: false,
    });
  });

  it('rôle texte : schéma JSON strict', () => {
    expect(buildGroqBody({ role: 'texte', messages, json: SCHEMA, maxTokens: 900, temperature: 0.5 }, models)).toEqual({
      model: 'm-texte',
      messages,
      temperature: 0.5,
      max_completion_tokens: 900,
      reasoning_effort: 'low',
      include_reasoning: false,
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'reponse', strict: true, schema: SCHEMA.schema },
      },
    });
  });

  it('rôle texte : mode JSON simple', () => {
    expect(buildGroqBody({ role: 'texte', messages, json: true }, models).response_format).toEqual({
      type: 'json_object',
    });
  });

  it('mode JSON simple : ajoute le mot JSON s\'il manque dans les messages', () => {
    const body = buildGroqBody({ role: 'texte', messages: [{ role: 'user', content: 'Liste trois cépages.' }], json: true }, models);
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0]).toEqual({ role: 'system', content: expect.stringContaining('JSON') });
    expect(body.messages[1]).toEqual({ role: 'user', content: 'Liste trois cépages.' });
  });

  it('rôle vision : pas de reasoning_effort ni d\'include_reasoning', () => {
    const visionMessages = [
      {
        role: 'user' as const,
        content: [
          { type: 'text' as const, text: 'Lis cette étiquette et réponds en JSON.' },
          { type: 'image_url' as const, image_url: { url: JPEG } },
        ],
      },
    ];
    expect(buildGroqBody({ role: 'vision', messages: visionMessages, json: SCHEMA }, models)).toEqual({
      model: 'm-vision',
      messages: visionMessages,
      temperature: 0.2,
      max_completion_tokens: 1200,
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'reponse', strict: true, schema: SCHEMA.schema },
      },
    });
  });

  it('rôle web : outil de recherche imposé, jamais de response_format', () => {
    const expected = {
      model: 'm-web',
      messages,
      tools: [{ type: 'browser_search' }],
      tool_choice: 'required',
      reasoning_effort: 'low',
      max_completion_tokens: 4096,
    };
    expect(buildGroqBody({ role: 'web', messages }, models)).toEqual(expected);
    for (const json of [true, SCHEMA]) {
      const body = buildGroqBody({ role: 'web', messages, json, temperature: 0.9 }, models);
      expect(body).toEqual(expected);
      expect(body).not.toHaveProperty('response_format');
    }
  });

  it('n\'envoie jamais de champ déprécié ou refusé par Groq', () => {
    for (const role of ['texte', 'vision', 'web'] as const) {
      const body = buildGroqBody({ role, messages, json: SCHEMA, maxTokens: 100 }, models);
      for (const field of ['max_tokens', 'logprobs', 'logit_bias', 'top_logprobs', 'n', 'reasoning_format']) {
        expect(body).not.toHaveProperty(field);
      }
      expect(body.max_completion_tokens).toBe(100);
    }
  });

  it('utilise les modèles par défaut à défaut de modèles fournis', () => {
    expect(buildGroqBody({ role: 'texte', messages }).model).toBe('openai/gpt-oss-120b');
    expect(buildGroqBody({ role: 'vision', messages }, {}).model).toBe('qwen/qwen3.8-27b');
    expect(buildGroqBody({ role: 'web', messages }, null).model).toBe('openai/gpt-oss-120b');
  });

  it('accepte le résultat de validateAiRequest', () => {
    const request = valid({ role: 'texte', messages, json: SCHEMA, maxTokens: 321 });
    expect(buildGroqBody(request, models).max_completion_tokens).toBe(321);
  });
});

describe('parseGroqResponse', () => {
  const reply = (content: unknown, extra: Record<string, unknown> = {}): unknown => ({
    model: 'openai/gpt-oss-120b',
    choices: [{ finish_reason: 'stop', message: { role: 'assistant', content, ...extra } }],
  });

  it('lit le texte et le modèle', () => {
    expect(parseGroqResponse(reply('  {"a":1}  '), 'texte')).toEqual({
      content: '{"a":1}',
      modele: 'openai/gpt-oss-120b',
      web: false,
    });
  });

  it('retire les marqueurs de citation de la recherche web', () => {
    const parsed = parseGroqResponse(
      reply('Apogée entre 2025 et 2035 【2†L6-L10】. Source : RVF【11†L1-L4】【3†L2】\nÀ boire.', {
        executed_tools: [{ type: 'browser_search' }],
      }),
      'web',
    );
    expect(parsed.content).toBe('Apogée entre 2025 et 2035. Source : RVF\nÀ boire.');
    expect(parsed.content).not.toMatch(/[【】]/);
    expect(parsed.web).toBe(true);
  });

  it('ne touche pas au texte des autres rôles', () => {
    expect(parseGroqResponse(reply('{"note":"voir 【1】"}'), 'texte').content).toBe('{"note":"voir 【1】"}');
  });

  it('signale une recherche web non effectuée', () => {
    expect(parseGroqResponse(reply('Texte', { executed_tools: [] }), 'web').web).toBe(false);
    expect(parseGroqResponse(reply('Texte'), 'web').web).toBe(true);
    expect(parseGroqResponse(reply('Texte', { executed_tools: [{ type: 'browser_search' }] }), 'texte').web).toBe(false);
  });

  it('renvoie un modèle vide s\'il est absent', () => {
    expect(parseGroqResponse({ choices: [{ message: { content: 'ok' } }] }, 'texte').modele).toBe('');
  });

  it('lève une erreur explicite sans contenu', () => {
    for (const json of [null, {}, { choices: [] }, { choices: [{}] }, reply(null), reply(''), reply('   '), reply(12)]) {
      expect(() => parseGroqResponse(json, 'texte')).toThrow(/réponse vide/);
    }
    expect(() =>
      parseGroqResponse({ choices: [{ finish_reason: 'length', message: { content: '' } }] }, 'texte'),
    ).toThrow(/limite de longueur/);
  });
});

describe('stripCitations', () => {
  it('retire les marqueurs et les espaces orphelins, sans toucher à la ponctuation française', () => {
    expect(stripCitations('Un 【1†L1-L2】, deux【2】【4】.  Trois   mots 【3†x】')).toBe('Un, deux. Trois mots');
    expect(stripCitations('Faut-il attendre ? Oui : jusqu\'en 2030 【5†L1】 !')).toBe('Faut-il attendre ? Oui : jusqu\'en 2030 !');
    expect(stripCitations('Sans marqueur.')).toBe('Sans marqueur.');
  });
});

describe('parseRetryAfter / formatDelay', () => {
  it('lit un en-tête en secondes', () => {
    expect(parseRetryAfter('7', null)).toBe(7);
    expect(parseRetryAfter('7.2', null)).toBe(8);
    expect(parseRetryAfter('0', null)).toBe(1);
  });

  it('lit une date HTTP', () => {
    const inThirtySeconds = new Date(Date.now() + 30_000).toUTCString();
    const delay = parseRetryAfter(inThirtySeconds, null);
    expect(delay).toBeGreaterThanOrEqual(28);
    expect(delay).toBeLessThanOrEqual(31);
  });

  it('lit le délai dans le message de Groq quand l\'en-tête est illisible', () => {
    expect(parseRetryAfter(null, 'Rate limit reached. Please try again in 7.66s. Need more tokens?')).toBe(8);
    expect(parseRetryAfter(null, 'Please try again in 1m26.4s.')).toBe(87);
    expect(parseRetryAfter(undefined, 'Please try again in 450ms.')).toBe(1);
    expect(parseRetryAfter(null, 'Please try again in 2h3m.')).toBe(7380);
  });

  it('renvoie undefined si le délai est inconnu', () => {
    expect(parseRetryAfter(null, 'Rate limit reached')).toBeUndefined();
    expect(parseRetryAfter('', undefined)).toBeUndefined();
    expect(parseRetryAfter('bientôt', null)).toBeUndefined();
  });

  it('formate les délais', () => {
    expect(formatDelay(7)).toBe('7 s');
    expect(formatDelay(180)).toBe('3 min');
    expect(formatDelay(7200)).toBe('2 h');
  });
});

describe('mapGroqError', () => {
  const models: AiModels = { texte: 'm-texte', vision: 'm-vision', web: 'm-web' };
  const body = (message: string, code = ''): unknown => ({ error: { message, type: 'invalid_request_error', code } });

  it.each([401, 403])('%i → clé refusée, message selon le contexte', (status) => {
    const serveur = mapGroqError(status, body('Invalid API Key', 'invalid_api_key'), null, 'serveur', models);
    expect(serveur).toEqual({
      code: 'cle-invalide',
      status: 401,
      message: expect.stringContaining('La clé Groq du serveur est refusée : vérifiez la variable GROQ_API_KEY'),
    });
    const perso = mapGroqError(status, body('Invalid API Key', 'invalid_api_key'), null, 'cle-perso', models);
    expect(perso.code).toBe('cle-invalide');
    expect(perso.message).toContain('La clé Groq saisie dans les réglages est refusée');
    expect(perso.message).not.toContain('GROQ_API_KEY');
  });

  it('404 → modèle indisponible, avec son nom et la variable à changer (serveur)', () => {
    const cases = [
      ['texte', 'm-texte', 'GROQ_MODEL_TEXT'],
      ['vision', 'm-vision', 'GROQ_MODEL_VISION'],
      ['web', 'm-web', 'GROQ_MODEL_WEB'],
    ] as const;
    for (const [role, model, variable] of cases) {
      const mapped = mapGroqError(404, body('Not found', 'model_not_found'), null, 'serveur', models, role);
      expect(mapped.code).toBe('indisponible');
      expect(mapped.status).toBe(404);
      expect(mapped.message).toContain(`« ${model} »`);
      expect(mapped.message).toContain(variable);
    }
  });

  it('404 → modèle indisponible (clé personnelle) : renvoie aux réglages, pas aux variables serveur', () => {
    const mapped = mapGroqError(404, null, null, 'cle-perso', models, 'vision');
    expect(mapped.code).toBe('indisponible');
    expect(mapped.message).toContain('« m-vision »');
    expect(mapped.message).toContain('réglages');
    expect(mapped.message).not.toContain('GROQ_MODEL');
  });

  it('modèle retiré signalé par un autre statut (message « decommissioned » / « does not exist »)', () => {
    const retired = mapGroqError(
      400,
      body('The model `llama-3.3-70b-versatile` has been decommissioned and is no longer supported.', 'model_decommissioned'),
      null,
      'serveur',
      models,
      'texte',
    );
    expect(retired).toMatchObject({ code: 'indisponible', status: 404 });
    expect(retired.message).toContain('GROQ_MODEL_TEXT');
    const missing = mapGroqError(400, body('The model `x` does not exist or you do not have access to it.'), null, 'serveur', models);
    expect(missing.code).toBe('indisponible');
    // Sans rôle connu : les trois variables sont citées.
    expect(missing.message).toMatch(/GROQ_MODEL_TEXT.*GROQ_MODEL_VISION.*GROQ_MODEL_WEB/);
  });

  it('413 → trop volumineux', () => {
    expect(mapGroqError(413, body('Request too large'), null, 'serveur', models)).toMatchObject({
      code: 'trop-volumineux',
      status: 413,
    });
  });

  it('429 → quota, avec le délai de l\'en-tête', () => {
    const mapped = mapGroqError(429, body('Rate limit reached'), '12', 'serveur', models);
    expect(mapped).toEqual({
      code: 'quota',
      status: 429,
      retryAfter: 12,
      message: 'Quota de l\'IA atteint : réessayez dans 12 s.',
    });
  });

  it('429 → quota, délai lu dans le message si l\'en-tête n\'est pas lisible (navigateur)', () => {
    const mapped = mapGroqError(429, body('Rate limit reached. Please try again in 3m20s.'), null, 'cle-perso', models);
    expect(mapped.retryAfter).toBe(200);
    expect(mapped.message).toContain('3 min');
  });

  it('429 → quota sans délai connu', () => {
    const mapped = mapGroqError(429, null, null, 'cle-perso', models);
    expect(mapped.code).toBe('quota');
    expect(mapped).not.toHaveProperty('retryAfter');
    expect(mapped.message).toContain('quelques instants');
  });

  it.each([498, 500, 502, 503, 504])('%i → indisponible (panne amont, renvoyée en 502)', (status) => {
    const mapped = mapGroqError(status, null, null, 'serveur', models);
    expect(mapped.code).toBe('indisponible');
    expect(mapped.status).toBe(502);
    expect(mapped.message).toContain(String(status));
  });

  it.each([400, 422])('%i → réponse invalide, avec le message de Groq', (status) => {
    const mapped = mapGroqError(status, body('Failed to generate JSON', 'json_validate_failed'), null, 'serveur', models);
    expect(mapped).toMatchObject({ code: 'reponse-invalide', status });
    expect(mapped.message).toContain('Failed to generate JSON');
    expect(mapGroqError(status, null, null, 'serveur', models).code).toBe('reponse-invalide');
  });

  it('statut inattendu → indisponible', () => {
    expect(mapGroqError(418, null, null, 'serveur', models)).toMatchObject({ code: 'indisponible', status: 502 });
  });

  it('ne laisse jamais passer une clé dans le message', () => {
    const mapped = mapGroqError(400, body('Bad request for key gsk_AbCdEf0123456789 somewhere'), null, 'serveur', models);
    expect(mapped.message).not.toContain('gsk_AbCdEf0123456789');
  });

  it('renvoie toujours un code d\'erreur de l\'application et un message', () => {
    const codes: AiErrorCode[] = [];
    for (const status of [400, 401, 403, 404, 413, 422, 429, 498, 500, 503, 418]) {
      for (const contexte of ['serveur', 'cle-perso'] as const) {
        const mapped = mapGroqError(status, null, null, contexte, models);
        codes.push(mapped.code);
        expect(mapped.message.length).toBeGreaterThan(10);
      }
    }
    expect(new Set(codes)).toEqual(new Set(['reponse-invalide', 'cle-invalide', 'indisponible', 'trop-volumineux', 'quota']));
  });
});
