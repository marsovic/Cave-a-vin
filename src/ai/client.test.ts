import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GROQ_URL } from '../../shared/groq.js';
import { AI_ENDPOINT, aiComplete, getAiStatus, resetAiStatusCache, setAiClientDeps } from './client';
import type { AiClientDeps } from './client';
import { AiError, DEFAULT_AI_SETTINGS } from './types';
import type { AiErrorCode, AiRequest, AiSettings } from './types';

const SERVEUR: AiSettings = { ...DEFAULT_AI_SETTINGS };
const PERSO: AiSettings = { ...DEFAULT_AI_SETTINGS, cleGroq: 'gsk_cle_personnelle' };
const REQUEST: AiRequest = { role: 'texte', messages: [{ role: 'user', content: 'Bonjour' }] };

type FetchMock = ReturnType<typeof vi.fn<AiClientDeps['fetch']>>;

let fetchMock: FetchMock;
let sleeps: number[];
let now: number;
let restore: () => void;

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

const serverOk = (content = 'Bonjour !'): Response => json(200, { content, modele: 'openai/gpt-oss-120b', web: false });
const serverError = (status: number, code: AiErrorCode, message: string, retryAfter?: number): Response =>
  json(status, { error: retryAfter === undefined ? { code, message } : { code, message, retryAfter } });
const groqOk = (content = 'Bonjour !'): Response =>
  json(200, { model: 'openai/gpt-oss-120b', choices: [{ finish_reason: 'stop', message: { content } }] });
const groqError = (status: number, message: string, headers: Record<string, string> = {}): Response =>
  json(status, { error: { message, type: 'erreur', code: '' } }, headers);

/** `fetch` qui ne répond jamais, mais échoue comme le vrai quand la requête est annulée. */
function hangingFetch(): FetchMock {
  return vi.fn<AiClientDeps['fetch']>(
    (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      }),
  );
}

async function failure(promise: Promise<unknown>): Promise<AiError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(AiError);
    return error as AiError;
  }
  throw new Error('une AiError était attendue');
}

function headersOf(call: number): Record<string, string> {
  return fetchMock.mock.calls[call]![1].headers as Record<string, string>;
}

function bodyOf(call: number): Record<string, unknown> {
  return JSON.parse(fetchMock.mock.calls[call]![1].body as string) as Record<string, unknown>;
}

beforeEach(() => {
  fetchMock = vi.fn<AiClientDeps['fetch']>();
  sleeps = [];
  now = 1_000_000;
  resetAiStatusCache();
  restore = setAiClientDeps({
    fetch: (url, init) => fetchMock(url, init),
    sleep: (ms) => {
      sleeps.push(ms);
      return Promise.resolve();
    },
    now: () => now,
  });
});

afterEach(() => {
  restore();
});

describe('aiComplete — mode serveur', () => {
  it('poste la requête sur /api/ai et renvoie la réponse', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { content: 'Santé !', modele: 'm', web: true }));
    const response = await aiComplete({ ...REQUEST, json: true, maxTokens: 300 }, SERVEUR);

    expect(response).toEqual({ content: 'Santé !', modele: 'm', web: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/ai');
    expect(url).toBe(AI_ENDPOINT);
    expect(init.method).toBe('POST');
    expect(headersOf(0)).toEqual({ 'Content-Type': 'application/json', Accept: 'application/json' });
    expect(bodyOf(0)).toEqual({
      role: 'texte',
      messages: REQUEST.messages,
      json: true,
      maxTokens: 300,
      temperature: 0.2,
    });
  });

  it('joint le code d\'accès en en-tête x-bacchus-code', async () => {
    fetchMock.mockResolvedValueOnce(serverOk());
    await aiComplete(REQUEST, { ...SERVEUR, codeAcces: '  sesame  ' });
    expect(headersOf(0)['x-bacchus-code']).toBe('sesame');
    expect(headersOf(0)).not.toHaveProperty('Authorization');
  });

  it('n\'envoie ni clé ni modèle au serveur', async () => {
    fetchMock.mockResolvedValueOnce(serverOk());
    await aiComplete(REQUEST, { ...SERVEUR, cleGroq: '   ', modeleTexte: 'un/modele' });
    const sent = `${JSON.stringify(headersOf(0))} ${fetchMock.mock.calls[0]![1].body as string}`;
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/ai');
    expect(sent).not.toMatch(/gsk_|Authorization|Bearer|un\/modele|"model"/);
  });

  it('transmet les erreurs du serveur avec leur code et leur message', async () => {
    const cases: [number, AiErrorCode, string][] = [
      [401, 'code-acces', 'Code d\'accès refusé.'],
      [401, 'cle-invalide', 'La clé Groq du serveur est refusée : vérifiez la variable GROQ_API_KEY.'],
      [503, 'indisponible', 'L\'assistant IA n\'est pas configuré sur ce serveur (variable GROQ_API_KEY absente).'],
      [404, 'indisponible', 'Le modèle « x » n\'est pas disponible chez Groq.'],
      [413, 'trop-volumineux', 'Demande trop volumineuse.'],
      [400, 'reponse-invalide', 'Requête IA invalide.'],
      [504, 'indisponible', 'L\'IA n\'a pas répondu à temps.'],
    ];
    for (const [status, code, message] of cases) {
      fetchMock.mockReset();
      fetchMock.mockResolvedValueOnce(serverError(status, code, message));
      const error = await failure(aiComplete(REQUEST, SERVEUR));
      expect(error.code).toBe(code);
      expect(error.message).toBe(message);
      // Aucune de ces erreurs ne se réessaie.
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
    expect(sleeps).toEqual([]);
  });

  it('réponse HTML (hébergeur sans fonction /api) → indisponible', async () => {
    for (const status of [200, 404, 405]) {
      fetchMock.mockReset();
      fetchMock.mockResolvedValueOnce(
        new Response('<!doctype html><html><body>Bacchus</body></html>', { status, headers: { 'content-type': 'text/html' } }),
      );
      const error = await failure(aiComplete(REQUEST, SERVEUR));
      expect(error.code).toBe('indisponible');
      expect(error.message).toContain('/api/ai');
      expect(error.message).toContain('clé Groq');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
  });

  it('réponse JSON inattendue → indisponible', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { bonjour: 'monde' }));
    expect((await failure(aiComplete(REQUEST, SERVEUR))).code).toBe('indisponible');
  });

  it('refuse un code d\'accès impossible à transmettre en en-tête, sans appel réseau', async () => {
    const error = await failure(aiComplete(REQUEST, { ...SERVEUR, codeAcces: 'code 🍷' }));
    expect(error.code).toBe('code-acces');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('aiComplete — clé personnelle', () => {
  it('appelle directement Groq avec la clé en Authorization', async () => {
    fetchMock.mockResolvedValueOnce(groqOk('  Santé !  '));
    const response = await aiComplete({ ...REQUEST, maxTokens: 300 }, { ...PERSO, cleGroq: '  gsk_cle_personnelle \n' });

    expect(response).toEqual({ content: 'Santé !', modele: 'openai/gpt-oss-120b', web: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect(url).toBe(GROQ_URL);
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('omit');
    expect(headersOf(0)).toEqual({ Authorization: 'Bearer gsk_cle_personnelle', 'Content-Type': 'application/json' });
    expect(bodyOf(0)).toEqual({
      model: 'openai/gpt-oss-120b',
      messages: REQUEST.messages,
      temperature: 0.2,
      max_completion_tokens: 300,
      reasoning_effort: 'low',
      include_reasoning: false,
    });
  });

  it('n\'envoie jamais la clé personnelle à /api/ai, ni le code d\'accès à Groq', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(groqOk()));
    const settings = { ...PERSO, codeAcces: 'sesame' };
    await aiComplete(REQUEST, settings);
    await aiComplete({ role: 'web', messages: REQUEST.messages }, settings);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [url, init] of fetchMock.mock.calls) {
      expect(url).toBe(GROQ_URL);
      const sent = `${JSON.stringify(init.headers)} ${init.body as string}`;
      expect(sent).not.toContain('sesame');
      expect(sent.toLowerCase()).not.toContain('x-bacchus-code');
    }
  });

  it('utilise les modèles par défaut selon le rôle, surchargeables dans les réglages', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(groqOk()));
    const image = 'data:image/jpeg;base64,/9j/4AAQ';
    const vision: AiRequest = {
      role: 'vision',
      messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: image } }] }],
    };
    await aiComplete(vision, PERSO);
    await aiComplete({ role: 'web', messages: REQUEST.messages, json: true }, PERSO);
    await aiComplete(REQUEST, { ...PERSO, modeleTexte: 'openai/gpt-oss-20b', modeleVision: 'v', modeleWeb: 'w' });
    await aiComplete(vision, { ...PERSO, modeleVision: 'autre/vision' });

    expect(bodyOf(0).model).toBe('qwen/qwen3.8-27b');
    expect(bodyOf(0)).not.toHaveProperty('reasoning_effort');
    expect(bodyOf(1).model).toBe('openai/gpt-oss-120b');
    expect(bodyOf(1).tools).toEqual([{ type: 'browser_search' }]);
    expect(bodyOf(1)).not.toHaveProperty('response_format');
    expect(bodyOf(2).model).toBe('openai/gpt-oss-20b');
    expect(bodyOf(3).model).toBe('autre/vision');
  });

  it('nettoie les citations de la recherche web', async () => {
    fetchMock.mockResolvedValueOnce(groqOk('Apogée vers 2030 【4†L1-L3】.'));
    const response = await aiComplete({ role: 'web', messages: REQUEST.messages }, PERSO);
    expect(response).toEqual({ content: 'Apogée vers 2030.', modele: 'openai/gpt-oss-120b', web: true });
  });

  it('traduit les erreurs de Groq', async () => {
    const cases: [number, AiErrorCode, RegExp][] = [
      [401, 'cle-invalide', /clé Groq saisie dans les réglages est refusée/],
      [403, 'cle-invalide', /clé Groq saisie dans les réglages est refusée/],
      [404, 'indisponible', /« openai\/gpt-oss-120b »/],
      [413, 'trop-volumineux', /trop volumineuse/],
      [400, 'reponse-invalide', /réponse exploitable/],
    ];
    for (const [status, code, message] of cases) {
      fetchMock.mockReset();
      fetchMock.mockResolvedValueOnce(groqError(status, 'Upstream message'));
      const error = await failure(aiComplete(REQUEST, PERSO));
      expect(error.code).toBe(code);
      expect(error.message).toMatch(message);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
    expect(sleeps).toEqual([]);
  });

  it('réponse vide de Groq → réponse invalide', async () => {
    fetchMock.mockResolvedValueOnce(groqOk(''));
    expect((await failure(aiComplete(REQUEST, PERSO))).code).toBe('reponse-invalide');
  });

  it('refuse une clé contenant des caractères impossibles, sans appel réseau', async () => {
    const error = await failure(aiComplete(REQUEST, { ...PERSO, cleGroq: 'gsk_clé avec espace' }));
    expect(error.code).toBe('cle-invalide');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('aiComplete — garde-fous', () => {
  it('IA désactivée → erreur immédiate, sans appel réseau', async () => {
    for (const settings of [{ ...SERVEUR, desactivee: true }, { ...PERSO, desactivee: true }]) {
      const error = await failure(aiComplete(REQUEST, settings));
      expect(error.code).toBe('desactivee');
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('requête invalide → erreur immédiate, sans appel réseau', async () => {
    const error = await failure(aiComplete({ role: 'texte', messages: [] }, SERVEUR));
    expect(error.code).toBe('reponse-invalide');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('aiComplete — réessais', () => {
  it('429 avec délai court : attend le délai annoncé puis réessaie', async () => {
    fetchMock
      .mockResolvedValueOnce(serverError(429, 'quota', 'Quota de l\'IA atteint : réessayez dans 3 s.', 3))
      .mockResolvedValueOnce(serverOk('Enfin'));
    const response = await aiComplete(REQUEST, SERVEUR);
    expect(response.content).toBe('Enfin');
    expect(sleeps).toEqual([3000]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('429 de Groq avec en-tête retry-after court (clé personnelle)', async () => {
    fetchMock
      .mockResolvedValueOnce(groqError(429, 'Rate limit reached', { 'retry-after': '20' }))
      .mockResolvedValueOnce(groqOk('Enfin'));
    expect((await aiComplete(REQUEST, PERSO)).content).toBe('Enfin');
    expect(sleeps).toEqual([20_000]);
  });

  it('429 de Groq sans en-tête lisible : délai lu dans le message', async () => {
    fetchMock
      .mockResolvedValueOnce(groqError(429, 'Rate limit reached. Please try again in 4.2s.'))
      .mockResolvedValueOnce(groqOk());
    await aiComplete(REQUEST, PERSO);
    expect(sleeps).toEqual([5000]);
  });

  it('429 du serveur : délai lu dans l\'en-tête retry-after à défaut du corps', async () => {
    fetchMock
      .mockResolvedValueOnce(json(429, { error: { code: 'quota', message: 'Quota atteint.' } }, { 'retry-after': '6' }))
      .mockResolvedValueOnce(serverOk());
    await aiComplete(REQUEST, SERVEUR);
    expect(sleeps).toEqual([6000]);
  });

  it('429 avec délai long : échoue tout de suite, le délai figure dans le message', async () => {
    fetchMock.mockResolvedValueOnce(groqError(429, 'Rate limit reached', { 'retry-after': '21' }));
    const error = await failure(aiComplete(REQUEST, PERSO));
    expect(error.code).toBe('quota');
    expect(error.retryAfter).toBe(21);
    expect(error.message).toContain('21 s');
    expect(sleeps).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock.mockReset();
    fetchMock.mockResolvedValueOnce(serverError(429, 'quota', 'Quota de l\'IA atteint : réessayez dans 12 min.', 720));
    const viaServer = await failure(aiComplete(REQUEST, SERVEUR));
    expect(viaServer.retryAfter).toBe(720);
    expect(viaServer.message).toContain('12 min');
    expect(sleeps).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('429 sans délai connu : attend 2 s puis 4 s, puis abandonne', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(groqError(429, 'Rate limit reached')));
    const error = await failure(aiComplete(REQUEST, PERSO));
    expect(error.code).toBe('quota');
    expect(sleeps).toEqual([2000, 4000]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('429 répété avec délai court : au plus 2 réessais', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(serverError(429, 'quota', 'Quota atteint.', 5)));
    const error = await failure(aiComplete(REQUEST, SERVEUR));
    expect(error.code).toBe('quota');
    expect(sleeps).toEqual([5000, 5000]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('500 puis succès (serveur)', async () => {
    fetchMock
      .mockResolvedValueOnce(serverError(502, 'indisponible', 'Le service Groq est momentanément indisponible (erreur 500).'))
      .mockResolvedValueOnce(serverOk('Rétabli'));
    expect((await aiComplete(REQUEST, SERVEUR)).content).toBe('Rétabli');
    expect(sleeps).toEqual([2000]);
  });

  it('500 puis succès (clé personnelle)', async () => {
    fetchMock.mockResolvedValueOnce(new Response('Internal Server Error', { status: 500 })).mockResolvedValueOnce(groqOk('Rétabli'));
    expect((await aiComplete(REQUEST, PERSO)).content).toBe('Rétabli');
    expect(sleeps).toEqual([2000]);
  });

  it('panne persistante : 2 réessais (2 s, 4 s) puis indisponible', async () => {
    for (const [settings, status] of [
      [PERSO, 503],
      [PERSO, 498],
      [SERVEUR, 500],
    ] as const) {
      fetchMock.mockReset();
      sleeps.length = 0;
      fetchMock.mockImplementation(() => Promise.resolve(new Response('panne', { status })));
      const error = await failure(aiComplete(REQUEST, settings));
      expect(error.code).toBe('indisponible');
      expect(sleeps).toEqual([2000, 4000]);
      expect(fetchMock).toHaveBeenCalledTimes(3);
    }
  });

  it('422 : un seul réessai', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(groqError(422, 'Unprocessable')));
    const error = await failure(aiComplete(REQUEST, PERSO));
    expect(error.code).toBe('reponse-invalide');
    expect(sleeps).toEqual([2000]);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    fetchMock.mockReset();
    sleeps.length = 0;
    fetchMock
      .mockResolvedValueOnce(serverError(422, 'reponse-invalide', 'L\'IA n\'a pas pu produire de réponse exploitable.'))
      .mockResolvedValueOnce(serverOk('Mieux'));
    expect((await aiComplete(REQUEST, SERVEUR)).content).toBe('Mieux');
    expect(sleeps).toEqual([2000]);
  });

  it('ne réessaie pas un serveur non configuré (503) ni un délai dépassé (504)', async () => {
    fetchMock.mockResolvedValueOnce(new Response('FUNCTION_INVOCATION_TIMEOUT', { status: 504 }));
    expect((await failure(aiComplete(REQUEST, SERVEUR))).code).toBe('indisponible');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sleeps).toEqual([]);
  });
});

describe('aiComplete — annulation, réseau, délai', () => {
  it('signal déjà annulé → annule, sans appel réseau', async () => {
    const controller = new AbortController();
    controller.abort();
    expect((await failure(aiComplete(REQUEST, SERVEUR, controller.signal))).code).toBe('annule');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('annulation pendant la requête → annule', async () => {
    for (const settings of [SERVEUR, PERSO]) {
      const hanging = hangingFetch();
      fetchMock.mockImplementation(hanging);
      const controller = new AbortController();
      const pending = failure(aiComplete(REQUEST, settings, controller.signal));
      await Promise.resolve();
      controller.abort();
      const error = await pending;
      expect(error.code).toBe('annule');
      expect(hanging).toHaveBeenCalledTimes(1);
      expect(hanging.mock.calls[0]![1].signal?.aborted).toBe(true);
    }
  });

  it('annulation pendant l\'attente avant un réessai → annule, sans nouvel appel', async () => {
    restore();
    const controller = new AbortController();
    restore = setAiClientDeps({ fetch: (url, init) => fetchMock(url, init) });
    fetchMock.mockImplementation(() => {
      // L'utilisateur annule pendant les 2 s d'attente qui suivent cette réponse.
      setTimeout(() => controller.abort(), 5);
      return Promise.resolve(new Response('panne', { status: 500 }));
    });
    const error = await failure(aiComplete(REQUEST, PERSO, controller.signal));
    expect(error.code).toBe('annule');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('réseau coupé → reseau, message « Connexion impossible »', async () => {
    for (const settings of [SERVEUR, PERSO]) {
      fetchMock.mockReset();
      fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
      const error = await failure(aiComplete(REQUEST, settings));
      expect(error.code).toBe('reseau');
      expect(error.message).toMatch(/^Connexion impossible/);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
    expect(sleeps).toEqual([]);
  });

  it('délai maximal dépassé → indisponible, requête interrompue', async () => {
    const hanging = hangingFetch();
    fetchMock.mockImplementation(hanging);
    const restoreTimeout = setAiClientDeps({ timeoutMs: 20 });
    try {
      const error = await failure(aiComplete(REQUEST, SERVEUR));
      expect(error.code).toBe('indisponible');
      expect(error.message).toContain('à temps');
      expect(hanging.mock.calls[0]![1].signal?.aborted).toBe(true);
    } finally {
      restoreTimeout();
    }
  });

  it('le délai maximal est de 60 s par défaut', async () => {
    restore();
    restore = (): void => undefined;
    vi.useFakeTimers();
    const hanging = hangingFetch();
    const restoreFetch = setAiClientDeps({ fetch: hanging });
    try {
      const pending = failure(aiComplete(REQUEST, SERVEUR));
      await vi.advanceTimersByTimeAsync(59_000);
      expect(hanging.mock.calls[0]![1].signal?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1_000);
      const error = await pending;
      expect(error.code).toBe('indisponible');
      expect(error.message).toContain('60 s');
    } finally {
      restoreFetch();
      vi.useRealTimers();
    }
  });
});

describe('getAiStatus', () => {
  const configured = (extra: Record<string, unknown> = {}): Response =>
    json(200, {
      configured: true,
      codeRequired: false,
      codeOk: true,
      models: { texte: 't', vision: 'v', web: 'w' },
      ...extra,
    });

  it('IA désactivée : indisponible, sans appel réseau', async () => {
    const status = await getAiStatus({ ...PERSO, desactivee: true });
    expect(status).toEqual({ disponible: false, mode: 'aucun', codeRequis: false, message: expect.stringContaining('désactivé') });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('clé personnelle : disponible, sans appel réseau', async () => {
    const status = await getAiStatus(PERSO);
    expect(status).toEqual({ disponible: true, mode: 'cle-perso', codeRequis: false, message: expect.stringContaining('IA prête') });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('serveur configuré : disponible', async () => {
    fetchMock.mockResolvedValueOnce(configured());
    const status = await getAiStatus(SERVEUR);
    expect(status).toEqual({ disponible: true, mode: 'serveur', codeRequis: false, message: 'IA prête.' });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/ai');
    expect(init.method).toBe('GET');
    expect(headersOf(0)).toEqual({ Accept: 'application/json' });
  });

  it('serveur non configuré : indisponible, invite à saisir une clé', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { configured: false, codeRequired: false, codeOk: true, models: {} }));
    const status = await getAiStatus(SERVEUR);
    expect(status).toEqual({
      disponible: false,
      mode: 'aucun',
      codeRequis: false,
      message: expect.stringContaining('Aucune clé Groq configurée'),
    });
  });

  it('code d\'accès exigé et absent', async () => {
    fetchMock.mockResolvedValueOnce(configured({ codeRequired: true, codeOk: false }));
    const status = await getAiStatus(SERVEUR);
    expect(status).toEqual({
      disponible: false,
      mode: 'serveur',
      codeRequis: true,
      message: expect.stringContaining('demande un code d\'accès'),
    });
  });

  it('code d\'accès exigé et faux', async () => {
    fetchMock.mockResolvedValueOnce(configured({ codeRequired: true, codeOk: false }));
    const status = await getAiStatus({ ...SERVEUR, codeAcces: 'mauvais' });
    expect(headersOf(0)['x-bacchus-code']).toBe('mauvais');
    expect(status).toMatchObject({ disponible: false, mode: 'serveur', codeRequis: true });
    expect(status.message).toContain('Code d\'accès refusé');
  });

  it('code d\'accès exigé et bon', async () => {
    fetchMock.mockResolvedValueOnce(configured({ codeRequired: true, codeOk: true }));
    const status = await getAiStatus({ ...SERVEUR, codeAcces: 'sesame' });
    expect(status).toEqual({ disponible: true, mode: 'serveur', codeRequis: false, message: 'IA prête.' });
  });

  it('serveur sans champ codeOk : le code saisi est supposé bon', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(json(200, { configured: true, codeRequired: true })));
    expect((await getAiStatus({ ...SERVEUR, codeAcces: 'sesame' })).disponible).toBe(true);
    expect(await getAiStatus(SERVEUR)).toMatchObject({ disponible: false, codeRequis: true });
  });

  it('garde l\'état du serveur en mémoire 5 minutes', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(configured()));
    const first = await getAiStatus(SERVEUR);
    now += 4 * 60_000 + 59_000;
    expect(await getAiStatus({ ...SERVEUR })).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    now += 2_000;
    await getAiStatus(SERVEUR);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('oublie l\'état quand les réglages changent', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(configured()));
    await getAiStatus(SERVEUR);
    await getAiStatus({ ...SERVEUR, rechercheWeb: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await getAiStatus({ ...SERVEUR, codeAcces: 'sesame' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // Passage par la clé personnelle puis retour au serveur : nouvel appel.
    await getAiStatus(PERSO);
    await getAiStatus({ ...SERVEUR, codeAcces: 'sesame' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    // Désactivation puis réactivation : nouvel appel.
    await getAiStatus({ ...SERVEUR, codeAcces: 'sesame', desactivee: true });
    await getAiStatus({ ...SERVEUR, codeAcces: 'sesame' });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('resetAiStatusCache force une nouvelle interrogation', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(configured()));
    await getAiStatus(SERVEUR);
    resetAiStatusCache();
    await getAiStatus(SERVEUR);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('un refus du code d\'accès pendant une demande invalide l\'état en mémoire', async () => {
    fetchMock.mockResolvedValueOnce(configured());
    expect((await getAiStatus(SERVEUR)).disponible).toBe(true);
    fetchMock.mockResolvedValueOnce(serverError(401, 'code-acces', 'Ce serveur demande un code d\'accès.'));
    await failure(aiComplete(REQUEST, SERVEUR));
    fetchMock.mockResolvedValueOnce(configured({ codeRequired: true, codeOk: false }));
    expect(await getAiStatus(SERVEUR)).toMatchObject({ disponible: false, codeRequis: true });
  });

  it('hébergeur sans fonction /api (HTML) : indisponible, état mémorisé', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(new Response('<!doctype html><html></html>', { status: 200, headers: { 'content-type': 'text/html' } })),
    );
    const status = await getAiStatus(SERVEUR);
    expect(status).toMatchObject({ disponible: false, mode: 'aucun', codeRequis: false });
    expect(status.message).toContain('clé Groq');
    await getAiStatus(SERVEUR);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('réseau coupé : indisponible sans exception, et sans mise en mémoire', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const status = await getAiStatus(SERVEUR);
    expect(status).toMatchObject({ disponible: false, mode: 'aucun', codeRequis: false });
    expect(status.message).toContain('connexion');
    fetchMock.mockResolvedValueOnce(configured());
    expect((await getAiStatus(SERVEUR)).disponible).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('panne du serveur (5xx) : indisponible, sans mise en mémoire', async () => {
    fetchMock.mockResolvedValueOnce(new Response('panne', { status: 502 }));
    expect((await getAiStatus(SERVEUR)).disponible).toBe(false);
    fetchMock.mockResolvedValueOnce(configured());
    expect((await getAiStatus(SERVEUR)).disponible).toBe(true);
  });

  it('ne lève jamais d\'exception, même annulée ou avec un fetch défaillant', async () => {
    const controller = new AbortController();
    controller.abort();
    expect(await getAiStatus(SERVEUR, controller.signal)).toMatchObject({ disponible: false, mode: 'aucun' });
    fetchMock.mockImplementation(() => {
      throw new Error('fetch cassé');
    });
    expect(await getAiStatus(SERVEUR)).toMatchObject({ disponible: false, mode: 'aucun' });
  });
});
