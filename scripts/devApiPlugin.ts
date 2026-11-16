import type { IncomingMessage, ServerResponse } from 'node:http';
import { loadEnv } from 'vite';
import type { Connect, Plugin } from 'vite';
import { MAX_BODY_BYTES, handleAiRequest } from '../shared/aiHandler.js';

/**
 * Plugin Vite : sert `/api/ai` pendant `vite` (développement) et `vite preview`, avec la
 * même logique que la fonction Vercel `api/ai.js` (`handleAiRequest`).
 *
 * Les variables GROQ_API_KEY, APP_ACCESS_CODE et GROQ_MODEL_* sont lues dans `.env`,
 * `.env.local`… (voir `.env.example`) et dans l'environnement du processus ; elles restent
 * côté serveur et ne sont jamais exposées au code du navigateur.
 */

const API_PATH = '/api/ai';

function readBody(req: IncomingMessage, limit: number): Promise<Buffer | null> {
  return new Promise<Buffer | null>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let overflow = false;
    req.on('data', (chunk: Buffer | string) => {
      const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
      size += buffer.length;
      if (size > limit) {
        // On continue de consommer la requête, sans la garder en mémoire.
        overflow = true;
        chunks.length = 0;
        return;
      }
      chunks.push(buffer);
    });
    req.on('end', () => resolve(overflow ? null : Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function toWebHeaders(req: IncomingMessage): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item);
    } else {
      headers.set(name, value);
    }
  }
  return headers;
}

async function serve(req: IncomingMessage, res: ServerResponse, env: Record<string, string>): Promise<void> {
  const method = (req.method ?? 'GET').toUpperCase();
  const headers = toWebHeaders(req);
  const url = `http://${req.headers.host ?? 'localhost'}${req.url ?? API_PATH}`;

  let request: Request;
  if (method === 'GET' || method === 'HEAD') {
    request = new Request(url, { method, headers });
  } else {
    const body = await readBody(req, MAX_BODY_BYTES);
    if (body === null) {
      // Corps trop volumineux : la taille annoncée suffit à `handleAiRequest` pour répondre 413.
      headers.set('content-length', String(MAX_BODY_BYTES + 1));
      request = new Request(url, { method, headers, body: '' });
    } else {
      headers.delete('content-length');
      headers.delete('transfer-encoding');
      request = new Request(url, { method, headers, body: new Uint8Array(body) });
    }
  }

  const response = await handleAiRequest(request, env, fetch, {
    log: (message) => console.error(message),
  });
  res.statusCode = response.status;
  response.headers.forEach((value, name) => res.setHeader(name, value));
  res.end(Buffer.from(await response.arrayBuffer()));
}

export function devApi(): Plugin {
  let env: Record<string, string> = {};

  const middleware: Connect.NextHandleFunction = (req, res, next) => {
    const path = (req.url ?? '').split('?')[0];
    if (path !== API_PATH) {
      next();
      return;
    }
    serve(req, res, env).catch(() => {
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader('content-type', 'application/json; charset=utf-8');
        res.setHeader('cache-control', 'no-store');
      }
      res.end(
        JSON.stringify({
          error: { code: 'indisponible', message: 'Erreur interne de l\'assistant IA (serveur de développement).' },
        }),
      );
    });
  };

  return {
    name: 'dumbcellar-dev-api',
    configResolved(config) {
      // Préfixe vide : toutes les variables des fichiers .env, pas seulement celles en VITE_.
      // Les variables déjà présentes dans l'environnement du processus restent prioritaires.
      env = loadEnv(config.mode, config.envDir, '');
    },
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}
