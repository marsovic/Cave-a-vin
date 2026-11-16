// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { MAX_BODY_BYTES, handleAiRequest, timingSafeEqualStrings } from '../../shared/aiHandler.js';
import type { AiFetch, AiHandlerEnv } from '../../shared/aiHandler.js';

const KEY = 'gsk_cle_secrete_du_serveur';
const ENV: AiHandlerEnv = { GROQ_API_KEY: KEY };
const URL_API = 'https://cave.test/api/ai';
const BODY = { role: 'texte', messages: [{ role: 'user', content: 'Bonjour' }] };

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(URL_API, {
    method: 'POST',
    headers: { 'content-type': 'application/json', host: 'cave.test', origin: 'https://cave.test', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function groqReply(content: string, extra: Record<string, unknown> = {}): Response {
  return new Response(
    JSON.stringify({ model: 'openai/gpt-oss-120b', choices: [{ finish_reason: 'stop', message: { content, ...extra } }] }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

function groqError(status: number, message: string, code = '', headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ error: { message, type: 'erreur', code } }), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function fetchReturning(...responses: Response[]): ReturnType<typeof vi.fn<AiFetch>> {
  const mock = vi.fn<AiFetch>();
  for (const response of responses) mock.mockResolvedValueOnce(response);
  return mock;
}

async function errorOf(response: Response): Promise<{ code: string; message: string; retryAfter?: number }> {
  const data = (await response.json()) as { error: { code: string; message: string; retryAfter?: number } };
  return data.error;
}

function expectJsonNoStore(response: Response): void {
  expect(response.headers.get('content-type')).toMatch(/^application\/json/);
  expect(response.headers.get('cache-control')).toBe('no-store');
}

describe('GET /api/ai', () => {
  it('décrit un serveur configuré sans code d\'accès', async () => {
    const fetchMock = fetchReturning();
    const response = await handleAiRequest(new Request(URL_API), ENV, fetchMock);
    expect(response.status).toBe(200);
    expectJsonNoStore(response);
    expect(await response.json()).toEqual({
      configured: true,
      codeRequired: false,
      codeOk: true,
      models: { texte: 'openai/gpt-oss-120b', vision: 'qwen/qwen3.8-27b', web: 'openai/gpt-oss-120b' },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('décrit un serveur sans clé', async () => {
    for (const env of [{}, { GROQ_API_KEY: '' }, { GROQ_API_KEY: '   ' }]) {
      const response = await handleAiRequest(new Request(URL_API), env);
      expect(await response.json()).toMatchObject({ configured: false, codeRequired: false });
    }
  });

  it('signale le code d\'accès exigé, et s\'il est bon', async () => {
    const env = { ...ENV, APP_ACCESS_CODE: 'sésame' };
    const sans = await handleAiRequest(new Request(URL_API), env);
    expect(await sans.json()).toMatchObject({ configured: true, codeRequired: true, codeOk: false });
    const faux = await handleAiRequest(new Request(URL_API, { headers: { 'x-bacchus-code': 'autre' } }), env);
    expect(await faux.json()).toMatchObject({ codeRequired: true, codeOk: false });
    const bon = await handleAiRequest(new Request(URL_API, { headers: { 'x-bacchus-code': 'sésame' } }), env);
    expect(await bon.json()).toMatchObject({ codeRequired: true, codeOk: true });
  });

  it('annonce les modèles choisis par les variables d\'environnement', async () => {
    const response = await handleAiRequest(new Request(URL_API), {
      ...ENV,
      GROQ_MODEL_TEXT: 'openai/gpt-oss-20b',
      GROQ_MODEL_VISION: ' un/modele-vision ',
      GROQ_MODEL_WEB: '',
    });
    expect(await response.json()).toMatchObject({
      models: { texte: 'openai/gpt-oss-20b', vision: 'un/modele-vision', web: 'openai/gpt-oss-120b' },
    });
  });

  it('ne révèle jamais la clé ni le code', async () => {
    const response = await handleAiRequest(new Request(URL_API), { ...ENV, APP_ACCESS_CODE: 'code-tres-secret' });
    const text = await response.text();
    expect(text).not.toContain(KEY);
    expect(text).not.toContain('code-tres-secret');
  });
});

describe('POST /api/ai — contrôles', () => {
  it('503 sans clé Groq sur le serveur', async () => {
    const fetchMock = fetchReturning();
    const response = await handleAiRequest(post(BODY), {}, fetchMock);
    expect(response.status).toBe(503);
    expectJsonNoStore(response);
    expect(await errorOf(response)).toEqual({
      code: 'indisponible',
      message: 'L\'assistant IA n\'est pas configuré sur ce serveur (variable GROQ_API_KEY absente).',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('401 si le code d\'accès est absent', async () => {
    const fetchMock = fetchReturning();
    const response = await handleAiRequest(post(BODY), { ...ENV, APP_ACCESS_CODE: 'sesame' }, fetchMock);
    expect(response.status).toBe(401);
    expectJsonNoStore(response);
    const error = await errorOf(response);
    expect(error.code).toBe('code-acces');
    expect(error.message).toContain('demande un code d\'accès');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('401 si le code d\'accès est faux', async () => {
    const fetchMock = fetchReturning();
    for (const code of ['sesam', 'sesame2', 'SESAME', 'x']) {
      const response = await handleAiRequest(
        post(BODY, { 'x-bacchus-code': code }),
        { ...ENV, APP_ACCESS_CODE: 'sesame' },
        fetchMock,
      );
      expect(response.status).toBe(401);
      const error = await errorOf(response);
      expect(error.code).toBe('code-acces');
      expect(error.message).toContain('Code d\'accès refusé');
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('accepte le bon code d\'accès', async () => {
    const fetchMock = fetchReturning(groqReply('Bonjour !'));
    const response = await handleAiRequest(
      post(BODY, { 'x-bacchus-code': 'sesame' }),
      { ...ENV, APP_ACCESS_CODE: 'sesame' },
      fetchMock,
    );
    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('le code d\'accès est exigé même sans clé Groq (401 avant 503)', async () => {
    const response = await handleAiRequest(post(BODY), { APP_ACCESS_CODE: 'sesame' });
    expect(response.status).toBe(401);
  });

  it('403 pour une origine étrangère', async () => {
    const fetchMock = fetchReturning();
    for (const origin of ['https://pirate.test', 'http://cave.test:8080', 'https://cave.test.pirate.test', 'null']) {
      const response = await handleAiRequest(post(BODY, { origin }), ENV, fetchMock);
      expect(response.status).toBe(403);
      expectJsonNoStore(response);
      expect((await errorOf(response)).code).toBe('indisponible');
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('403 pour une origine étrangère même avec le bon code d\'accès', async () => {
    const response = await handleAiRequest(
      post(BODY, { origin: 'https://pirate.test', 'x-bacchus-code': 'sesame' }),
      { ...ENV, APP_ACCESS_CODE: 'sesame' },
      fetchReturning(),
    );
    expect(response.status).toBe(403);
  });

  it('accepte la même origine (en-tête host)', async () => {
    const response = await handleAiRequest(post(BODY), ENV, fetchReturning(groqReply('ok')));
    expect(response.status).toBe(200);
  });

  it('compare l\'origine à x-forwarded-host en priorité (Vercel)', async () => {
    const accepted = await handleAiRequest(
      post(BODY, { origin: 'https://cave.exemple.fr', host: 'interne.vercel.test', 'x-forwarded-host': 'cave.exemple.fr' }),
      ENV,
      fetchReturning(groqReply('ok')),
    );
    expect(accepted.status).toBe(200);
    const refused = await handleAiRequest(
      post(BODY, { origin: 'https://cave.test', host: 'cave.test', 'x-forwarded-host': 'autre.exemple.fr' }),
      ENV,
      fetchReturning(),
    );
    expect(refused.status).toBe(403);
  });

  it('ne se fie pas au schéma : http en amont, https côté navigateur', async () => {
    const request = new Request('http://cave.test/api/ai', {
      method: 'POST',
      headers: { 'content-type': 'application/json', host: 'cave.test', origin: 'https://cave.test' },
      body: JSON.stringify(BODY),
    });
    expect((await handleAiRequest(request, ENV, fetchReturning(groqReply('ok')))).status).toBe(200);
  });

  it('accepte une requête sans en-tête Origin (outil en ligne de commande)', async () => {
    const request = new Request(URL_API, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(BODY),
    });
    expect((await handleAiRequest(request, ENV, fetchReturning(groqReply('ok')))).status).toBe(200);
  });

  it('400 pour un corps qui n\'est pas du JSON', async () => {
    const fetchMock = fetchReturning();
    const response = await handleAiRequest(post('ceci n\'est pas du JSON'), ENV, fetchMock);
    expect(response.status).toBe(400);
    expectJsonNoStore(response);
    expect((await errorOf(response)).code).toBe('reponse-invalide');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('400 pour une requête invalide, avec la raison', async () => {
    const fetchMock = fetchReturning();
    const cases: [unknown, RegExp][] = [
      [{ role: 'audio', messages: BODY.messages }, /rôle inconnu/],
      [{ role: 'texte', messages: [] }, /messages/],
      [
        {
          role: 'vision',
          messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'https://exemple.test/a.jpg' } }] }],
        },
        /data URL/,
      ],
      [[], /objet JSON/],
    ];
    for (const [body, reason] of cases) {
      const response = await handleAiRequest(post(body), ENV, fetchMock);
      expect(response.status).toBe(400);
      expect((await errorOf(response)).message).toMatch(reason);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('413 si la taille annoncée dépasse 4 Mo', async () => {
    const fetchMock = fetchReturning();
    const response = await handleAiRequest(post(BODY, { 'content-length': String(MAX_BODY_BYTES + 1) }), ENV, fetchMock);
    expect(response.status).toBe(413);
    expectJsonNoStore(response);
    expect((await errorOf(response)).code).toBe('trop-volumineux');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('413 si le corps réel dépasse 4 Mo', async () => {
    const fetchMock = fetchReturning();
    const huge = JSON.stringify({ role: 'texte', messages: [{ role: 'user', content: 'x'.repeat(MAX_BODY_BYTES) }] });
    const response = await handleAiRequest(post(huge), ENV, fetchMock);
    expect(response.status).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(['PUT', 'DELETE', 'PATCH', 'OPTIONS'])('405 pour la méthode %s', async (method) => {
    const fetchMock = fetchReturning();
    const response = await handleAiRequest(new Request(URL_API, { method }), ENV, fetchMock);
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('GET, POST');
    expectJsonNoStore(response);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/ai — appel de Groq', () => {
  it('relaie la requête : URL, clé en Authorization et corps Groq', async () => {
    const fetchMock = fetchReturning(groqReply('  {"ok":true}  '));
    const schema = { name: 'reponse', schema: { type: 'object', additionalProperties: false, required: [], properties: {} } };
    const response = await handleAiRequest(
      post({ ...BODY, json: schema, maxTokens: 700, temperature: 0.4, model: 'modele/pirate', n: 4 }),
      ENV,
      fetchMock,
    );

    expect(response.status).toBe(200);
    expectJsonNoStore(response);
    expect(await response.json()).toEqual({ content: '{"ok":true}', modele: 'openai/gpt-oss-120b', web: false });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ authorization: `Bearer ${KEY}`, 'content-type': 'application/json' });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(init.body)).toEqual({
      model: 'openai/gpt-oss-120b',
      messages: BODY.messages,
      temperature: 0.4,
      max_completion_tokens: 700,
      reasoning_effort: 'low',
      include_reasoning: false,
      response_format: { type: 'json_schema', json_schema: { name: 'reponse', strict: true, schema: schema.schema } },
    });
  });

  it('utilise les modèles des variables d\'environnement, selon le rôle', async () => {
    const env = { ...ENV, GROQ_MODEL_TEXT: 'm/texte', GROQ_MODEL_VISION: 'm/vision', GROQ_MODEL_WEB: 'm/web' };
    const image = 'data:image/jpeg;base64,/9j/4AAQ';
    const bodies: [unknown, string][] = [
      [BODY, 'm/texte'],
      [{ role: 'web', messages: BODY.messages }, 'm/web'],
      [
        { role: 'vision', messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: image } }] }] },
        'm/vision',
      ],
    ];
    for (const [body, model] of bodies) {
      const fetchMock = fetchReturning(groqReply('ok'));
      await handleAiRequest(post(body), env, fetchMock);
      expect((JSON.parse(fetchMock.mock.calls[0]![1].body) as { model: string }).model).toBe(model);
    }
  });

  it('rôle web : outil de recherche, pas de response_format, citations retirées', async () => {
    const fetchMock = fetchReturning(
      groqReply('À boire entre 2026 et 2034 【1†L2-L5】.', { executed_tools: [{ type: 'browser_search' }] }),
    );
    const response = await handleAiRequest(post({ role: 'web', messages: BODY.messages, json: true }), ENV, fetchMock);
    expect(await response.json()).toEqual({
      content: 'À boire entre 2026 et 2034.',
      modele: 'openai/gpt-oss-120b',
      web: true,
    });
    const sent = JSON.parse(fetchMock.mock.calls[0]![1].body) as Record<string, unknown>;
    expect(sent.tools).toEqual([{ type: 'browser_search' }]);
    expect(sent.tool_choice).toBe('required');
    expect(sent).not.toHaveProperty('response_format');
  });

  it('indique le modèle configuré si Groq ne le précise pas', async () => {
    const reply = new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 });
    const response = await handleAiRequest(post(BODY), { ...ENV, GROQ_MODEL_TEXT: 'm/texte' }, fetchReturning(reply));
    expect(await response.json()).toMatchObject({ modele: 'm/texte' });
  });

  it('502 si Groq répond sans contenu', async () => {
    const response = await handleAiRequest(post(BODY), ENV, fetchReturning(groqReply('')));
    expect(response.status).toBe(502);
    expect((await errorOf(response)).code).toBe('reponse-invalide');
  });

  it('502 si Groq répond autre chose que du JSON', async () => {
    const response = await handleAiRequest(post(BODY), ENV, fetchReturning(new Response('<html>oups</html>', { status: 200 })));
    expect(response.status).toBe(502);
    expect((await errorOf(response)).code).toBe('reponse-invalide');
  });

  it('erreur amont 401 → clé du serveur refusée', async () => {
    const response = await handleAiRequest(
      post(BODY),
      ENV,
      fetchReturning(groqError(401, 'Invalid API Key', 'invalid_api_key')),
    );
    expect(response.status).toBe(401);
    expectJsonNoStore(response);
    const error = await errorOf(response);
    expect(error.code).toBe('cle-invalide');
    expect(error.message).toContain('GROQ_API_KEY');
  });

  it('erreur amont 404 → modèle indisponible, variable à corriger', async () => {
    const response = await handleAiRequest(
      post(BODY),
      { ...ENV, GROQ_MODEL_TEXT: 'modele/retire' },
      fetchReturning(groqError(404, 'The model `modele/retire` does not exist', 'model_not_found')),
    );
    expect(response.status).toBe(404);
    const error = await errorOf(response);
    expect(error.code).toBe('indisponible');
    expect(error.message).toContain('« modele/retire »');
    expect(error.message).toContain('GROQ_MODEL_TEXT');
  });

  it('erreur amont 413 → trop volumineux', async () => {
    const response = await handleAiRequest(post(BODY), ENV, fetchReturning(groqError(413, 'Request too large')));
    expect(response.status).toBe(413);
    expect((await errorOf(response)).code).toBe('trop-volumineux');
  });

  it('erreur amont 429 → quota, retry-after transmis (corps et en-tête)', async () => {
    const response = await handleAiRequest(
      post(BODY),
      ENV,
      fetchReturning(groqError(429, 'Rate limit reached', 'rate_limit_exceeded', { 'retry-after': '17' })),
    );
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('17');
    expectJsonNoStore(response);
    expect(await errorOf(response)).toEqual({
      code: 'quota',
      message: 'Quota de l\'IA atteint : réessayez dans 17 s.',
      retryAfter: 17,
    });
  });

  it('erreur amont 429 sans délai connu → pas d\'en-tête retry-after', async () => {
    const response = await handleAiRequest(post(BODY), ENV, fetchReturning(groqError(429, 'Rate limit reached')));
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBeNull();
    expect(await errorOf(response)).not.toHaveProperty('retryAfter');
  });

  it('erreur amont 500 → indisponible (502)', async () => {
    const response = await handleAiRequest(post(BODY), ENV, fetchReturning(new Response('Internal Server Error', { status: 500 })));
    expect(response.status).toBe(502);
    expectJsonNoStore(response);
    expect((await errorOf(response)).code).toBe('indisponible');
  });

  it('erreur amont 400 → réponse invalide', async () => {
    const response = await handleAiRequest(
      post(BODY),
      ENV,
      fetchReturning(groqError(400, 'Failed to validate JSON', 'json_validate_failed')),
    );
    expect(response.status).toBe(400);
    expect((await errorOf(response)).code).toBe('reponse-invalide');
  });

  it('ne renvoie du corps d\'erreur amont que le message, jamais la clé', async () => {
    const upstream = new Response(
      JSON.stringify({ error: { message: `Bad key ${KEY}`, type: 't', code: 'c', secret: 'donnee-interne' }, debug: 'trace-interne' }),
      { status: 400 },
    );
    const response = await handleAiRequest(post(BODY), ENV, fetchReturning(upstream));
    const text = await response.text();
    expect(text).not.toContain(KEY);
    expect(text).not.toContain('donnee-interne');
    expect(text).not.toContain('trace-interne');
  });

  it('504 quand Groq ne répond pas dans le délai imparti', async () => {
    const fetchMock = vi.fn<AiFetch>(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal.addEventListener('abort', () => reject(init.signal.reason as Error));
        }),
    );
    const log = vi.fn<(message: string) => void>();
    const response = await handleAiRequest(post(BODY), ENV, fetchMock, { timeoutMs: 20, log });
    expect(response.status).toBe(504);
    expectJsonNoStore(response);
    const error = await errorOf(response);
    expect(error.code).toBe('indisponible');
    expect(error.message).toContain('à temps');
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]![0]).not.toContain(KEY);
  });

  it('accorde 55 s à Groq par défaut', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    try {
      await handleAiRequest(post(BODY), ENV, fetchReturning(groqReply('ok')));
      expect(timeout).toHaveBeenCalledWith(55_000);
    } finally {
      timeout.mockRestore();
    }
  });

  it('502 quand Groq est injoignable', async () => {
    const fetchMock = vi.fn<AiFetch>().mockRejectedValue(new TypeError('fetch failed'));
    const response = await handleAiRequest(post(BODY), ENV, fetchMock);
    expect(response.status).toBe(502);
    expect((await errorOf(response)).code).toBe('indisponible');
  });

  it('500 propre si le traitement lève une exception inattendue', async () => {
    const broken = { method: 'POST', headers: null } as unknown as Request;
    const response = await handleAiRequest(broken, ENV, fetchReturning());
    expect(response.status).toBe(500);
    expectJsonNoStore(response);
    expect((await errorOf(response)).code).toBe('indisponible');
  });
});

describe('timingSafeEqualStrings', () => {
  it('compare des chaînes', () => {
    expect(timingSafeEqualStrings('sesame', 'sesame')).toBe(true);
    expect(timingSafeEqualStrings('', '')).toBe(true);
    expect(timingSafeEqualStrings('sesame', 'sesamE')).toBe(false);
    expect(timingSafeEqualStrings('sesame', 'sesame ')).toBe(false);
    expect(timingSafeEqualStrings('sesame', '')).toBe(false);
    expect(timingSafeEqualStrings('a\u0000', 'a')).toBe(false);
  });
});
