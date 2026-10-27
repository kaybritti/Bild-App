import type { IncomingMessage, ServerResponse } from 'node:http';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import * as billing from './api/billing.ts';
import * as generate from './api/generate.ts';
import * as stripeWebhook from './api/stripe-webhook.ts';

type Handler = (request: Request) => Promise<Response>;

/** Dieselben Handler wie bei Vercel: Pfad → HTTP-Methode → Funktion. */
const ROUTES: Record<string, Partial<Record<'GET' | 'POST', Handler>>> = {
  '/api/generate': { POST: generate.POST },
  '/api/billing': { GET: billing.GET, POST: billing.POST },
  '/api/stripe-webhook': { POST: stripeWebhook.POST },
};

/** Serverseitige Variablen für api/*.ts (ohne VITE_-Präfix, landen nie im Browser-Bundle). */
const SERVER_ENV_KEYS = [
  'N8N_WEBHOOK_URL',
  'N8N_AUTH_HEADER_NAME',
  'N8N_AUTH_HEADER_VALUE',
  'N8N_BASIC_AUTH_USER',
  'N8N_BASIC_AUTH_PASSWORD',
  'SUPABASE_URL',
  'SUPABASE_PUBLISHABLE_KEY',
  'SUPABASE_SECRET_KEY',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'APP_URL',
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_PUBLISHABLE_KEY',
];

/** Werden beim Nachbauen der Anfrage neu gesetzt bzw. sind nur für die lokale Verbindung relevant. */
const HOP_BY_HOP_HEADERS = new Set(['host', 'connection', 'content-length', 'transfer-encoding', 'keep-alive']);

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 4_500_000) throw new RangeError('Request body too large');
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

async function sendResponse(res: ServerResponse, response: Response): Promise<void> {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => res.setHeader(key, value));
  res.end(Buffer.from(await response.arrayBuffer()));
}

/**
 * Führt im Dev-Server dieselbe Serverfunktion aus wie Vercel in Produktion,
 * damit lokal und online identisch getestet wird.
 */
function apiDevServer(): Plugin {
  return {
    name: 'ai-image-studio:api-dev-server',
    configureServer(server) {
      for (const [path, methods] of Object.entries(ROUTES)) {
        server.middlewares.use(path, (req, res) => {
          void (async () => {
            const handler = methods[req.method as 'GET' | 'POST'];
            if (!handler) {
              res.statusCode = 405;
              res.setHeader('allow', Object.keys(methods).join(', '));
              res.end();
              return;
            }
            const headers = new Headers();
            for (const [key, value] of Object.entries(req.headers)) {
              if (typeof value === 'string' && !HOP_BY_HOP_HEADERS.has(key)) headers.set(key, value);
            }
            const controller = new AbortController();
            req.once('aborted', () => controller.abort());
            res.once('close', () => { if (!res.writableEnded) controller.abort(); });
            // Echter Host statt „localhost“, damit Stripe-Rücksprung-URLs auf den Dev-Server zeigen.
            const request = new Request(`http://${req.headers.host ?? 'localhost'}${req.originalUrl ?? path}`, {
              method: req.method,
              headers,
              body: req.method === 'GET' ? undefined : new Uint8Array(await readBody(req)),
              signal: controller.signal,
            });
            await sendResponse(res, await handler(request));
          })().catch((error: unknown) => {
            server.config.logger.error(`[${path.slice(1)}] ${String(error)}`);
            if (!res.headersSent) res.statusCode = error instanceof RangeError ? 413 : 500;
            res.end();
          });
        });
      }
    },
  };
}

export default defineConfig(({ mode }) => {
  // Serverseitige Werte aus .env / .env.local für die lokale Serverfunktion bereitstellen.
  const env = loadEnv(mode, process.cwd(), '');
  for (const key of SERVER_ENV_KEYS) {
    if (env[key] && !process.env[key]) process.env[key] = env[key];
  }

  return {
    plugins: [react(), tailwindcss(), apiDevServer()],
  };
});
