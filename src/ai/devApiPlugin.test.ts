// @vitest-environment node
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, request as httpRequest } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { devApi } from '../../scripts/devApiPlugin';

type Middleware = (req: IncomingMessage, res: ServerResponse, next: () => void) => void;

const ENV_NAMES = ['GROQ_API_KEY', 'APP_ACCESS_CODE', 'GROQ_MODEL_TEXT', 'GROQ_MODEL_VISION', 'GROQ_MODEL_WEB'];
const saved = new Map<string, string | undefined>();
let envDir: string;
let server: Server;
let port: number;
const registered: Middleware[] = [];

interface Reply {
  status: number;
  headers: IncomingMessage['headers'];
  body: string;
}

function call(method: string, path: string, headers: Record<string, string> = {}, body?: string): Promise<Reply> {
  return new Promise<Reply>((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () =>
        resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }),
      );
    });
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

beforeAll(async () => {
  // Les variables du processus priment sur les fichiers .env : on les écarte le temps du test.
  for (const name of ENV_NAMES) {
    saved.set(name, process.env[name]);
    delete process.env[name];
  }
  envDir = mkdtempSync(join(tmpdir(), 'dumbcellar-dev-api-'));
  writeFileSync(join(envDir, '.env'), 'GROQ_API_KEY=gsk_cle_du_fichier_env\nGROQ_MODEL_TEXT=modele/du-fichier\n');
  writeFileSync(join(envDir, '.env.local'), 'APP_ACCESS_CODE=sesame\n');

  const plugin = devApi();
  expect(plugin.name).toBe('dumbcellar-dev-api');
  (plugin.configResolved as unknown as (config: unknown) => void)({ mode: 'development', envDir, root: envDir });
  const fakeServer = { middlewares: { use: (middleware: Middleware) => registered.push(middleware) } };
  (plugin.configureServer as unknown as (server: unknown) => void)(fakeServer);
  (plugin.configurePreviewServer as unknown as (server: unknown) => void)(fakeServer);

  server = createServer((req, res) => {
    registered[0]!(req, res, () => {
      res.statusCode = 404;
      res.end('suite de la chaîne Vite');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(envDir, { recursive: true, force: true });
  for (const [name, value] of saved) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('plugin Vite devApi', () => {
  it('s\'enregistre pour le serveur de développement et pour « vite preview »', () => {
    expect(registered).toHaveLength(2);
    expect(registered[0]).toBe(registered[1]);
  });

  it('GET /api/ai : état lu dans .env et .env.local', async () => {
    const reply = await call('GET', '/api/ai?x=1');
    expect(reply.status).toBe(200);
    expect(reply.headers['content-type']).toMatch(/^application\/json/);
    expect(reply.headers['cache-control']).toBe('no-store');
    expect(JSON.parse(reply.body)).toEqual({
      configured: true,
      codeRequired: true,
      codeOk: false,
      models: { texte: 'modele/du-fichier', vision: 'qwen/qwen3.8-27b', web: 'openai/gpt-oss-120b' },
    });
    expect(reply.body).not.toContain('gsk_');
  });

  it('laisse passer les autres adresses', async () => {
    for (const path of ['/', '/api/ai/autre', '/api/aide', '/src/main.tsx']) {
      const reply = await call('GET', path);
      expect(reply.status).toBe(404);
      expect(reply.body).toBe('suite de la chaîne Vite');
    }
  });

  it('POST /api/ai : relaie vers Groq avec la clé du fichier .env', async () => {
    const groq = vi.fn((_url: string, _init: { headers: Record<string, string>; body: string }) =>
      Promise.resolve(
        new Response(JSON.stringify({ model: 'modele/du-fichier', choices: [{ message: { content: 'Santé !' } }] }), { status: 200 }),
      ),
    );
    vi.stubGlobal('fetch', groq);
    const body = JSON.stringify({ role: 'texte', messages: [{ role: 'user', content: 'Bonjour é' }] });
    const reply = await call(
      'POST',
      '/api/ai',
      {
        'content-type': 'application/json',
        'content-length': String(Buffer.byteLength(body)),
        origin: `http://127.0.0.1:${port}`,
        'x-dumbcellar-code': 'sesame',
      },
      body,
    );
    expect(reply.status).toBe(200);
    expect(JSON.parse(reply.body)).toEqual({ content: 'Santé !', modele: 'modele/du-fichier', web: false });
    expect(groq).toHaveBeenCalledTimes(1);
    const [url, init] = groq.mock.calls[0]!;
    expect(url).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect(init.headers.authorization).toBe('Bearer gsk_cle_du_fichier_env');
    expect(JSON.parse(init.body)).toMatchObject({
      model: 'modele/du-fichier',
      messages: [{ role: 'user', content: 'Bonjour é' }],
    });
  });

  it('POST sans code d\'accès : 401, Groq n\'est pas appelé', async () => {
    const groq = vi.fn();
    vi.stubGlobal('fetch', groq);
    const reply = await call('POST', '/api/ai', { 'content-type': 'application/json', origin: `http://127.0.0.1:${port}` }, '{}');
    expect(reply.status).toBe(401);
    expect((JSON.parse(reply.body) as { error: { code: string } }).error.code).toBe('code-acces');
    expect(groq).not.toHaveBeenCalled();
  });

  it('POST d\'une autre origine : 403', async () => {
    const groq = vi.fn();
    vi.stubGlobal('fetch', groq);
    const reply = await call(
      'POST',
      '/api/ai',
      { 'content-type': 'application/json', origin: 'https://pirate.test', 'x-dumbcellar-code': 'sesame' },
      '{}',
    );
    expect(reply.status).toBe(403);
    expect(groq).not.toHaveBeenCalled();
  });

  it('POST trop volumineux : 413, Groq n\'est pas appelé', async () => {
    const groq = vi.fn();
    vi.stubGlobal('fetch', groq);
    const reply = await call(
      'POST',
      '/api/ai',
      { 'content-type': 'application/json', 'x-dumbcellar-code': 'sesame', 'transfer-encoding': 'chunked' },
      'x'.repeat(4 * 1024 * 1024 + 10),
    );
    expect(reply.status).toBe(413);
    expect((JSON.parse(reply.body) as { error: { code: string } }).error.code).toBe('trop-volumineux');
    expect(groq).not.toHaveBeenCalled();
  });

  it('autre méthode : 405', async () => {
    const reply = await call('DELETE', '/api/ai');
    expect(reply.status).toBe(405);
    expect(reply.headers.allow).toBe('GET, POST');
  });
});
