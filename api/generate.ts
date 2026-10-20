import { randomUUID } from 'node:crypto';
import sharp from 'sharp';

const MAX_BODY_BYTES = 4_500_000;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_PIXELS = 16_000_000;
const UPSTREAM_TIMEOUT_MS = 140_000;

interface ServerConfig {
  webhookUrl: string;
  supabaseUrl: string;
  supabaseKey: string;
  secretKey: string;
  authHeader: [string, string];
}

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

function env(...names: string[]): string {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return '';
}

function readConfig(): ServerConfig {
  const webhookUrl = env('N8N_WEBHOOK_URL');
  const supabaseUrl = env('SUPABASE_URL', 'VITE_SUPABASE_URL');
  const supabaseKey = env('SUPABASE_PUBLISHABLE_KEY', 'VITE_SUPABASE_PUBLISHABLE_KEY');
  const secretKey = env('SUPABASE_SECRET_KEY');
  const headerName = env('N8N_AUTH_HEADER_NAME');
  const headerValue = env('N8N_AUTH_HEADER_VALUE');
  const user = env('N8N_BASIC_AUTH_USER');
  const password = env('N8N_BASIC_AUTH_PASSWORD');
  const authHeader: [string, string] | null = headerName && headerValue
    ? [headerName, headerValue]
    : user && password
      ? ['Authorization', `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`]
      : null;
  if (!webhookUrl || !supabaseUrl || !supabaseKey || !secretKey || !authHeader) {
    throw new HttpError(503, 'Die Bildgenerierung ist noch nicht sicher konfiguriert. Bitte den Betreiber kontaktieren.');
  }
  if (new URL(webhookUrl).protocol !== 'https:' || new URL(supabaseUrl).protocol !== 'https:') {
    throw new HttpError(503, 'Die Bildgenerierung ist nicht verfügbar. Bitte den Betreiber kontaktieren.');
  }
  return { webhookUrl, supabaseUrl: supabaseUrl.replace(/\/+$/, ''), supabaseKey, secretKey, authHeader };
}

function fail(status: number, error: string, retryAfter?: number): Response {
  return Response.json({ error }, {
    status,
    headers: {
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      ...(retryAfter ? { 'retry-after': String(retryAfter) } : {}),
    },
  });
}

async function signedInUser(request: Request, config: ServerConfig): Promise<string> {
  const token = /^Bearer\s+(\S+)$/i.exec(request.headers.get('authorization') ?? '')?.[1];
  if (!token || token.length > 8192) throw new HttpError(401, 'Bitte melde dich erneut an.');
  try {
    const response = await fetch(`${config.supabaseUrl}/auth/v1/user`, {
      headers: { apikey: config.supabaseKey, Authorization: `Bearer ${token}` },
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(8_000)]),
      redirect: 'error',
    });
    if (response.status === 401 || response.status === 403) {
      throw new HttpError(401, 'Deine Sitzung ist abgelaufen. Bitte melde dich erneut an.');
    }
    if (!response.ok) throw new Error('Auth unavailable');
    const user: unknown = await response.json();
    if (!user || typeof user !== 'object' || !('id' in user) || typeof user.id !== 'string'
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(user.id)
      || !('email_confirmed_at' in user) || !user.email_confirmed_at
      || ('is_anonymous' in user && user.is_anonymous === true)) {
      throw new HttpError(401, 'Bitte melde dich mit einem bestätigten E-Mail-Konto an.');
    }
    return user.id;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(503, 'Die Anmeldung konnte gerade nicht geprüft werden. Bitte erneut versuchen.');
  }
}

/** Bound memory even without a trustworthy Content-Length. */
async function readLimited(
  source: Request | Response, limit: number, signal: AbortSignal, status: number,
): Promise<Uint8Array<ArrayBuffer>> {
  if (Number(source.headers.get('content-length') ?? 0) > limit) {
    await source.body?.cancel();
    throw new HttpError(status, 'Die übertragene Datei ist zu groß.');
  }
  if (!source.body) throw new HttpError(status, 'Die übertragene Datei ist leer.');
  const reader = source.body.getReader();
  const abort = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener('abort', abort, { once: true });
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    signal.throwIfAborted();
    while (true) {
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new HttpError(status, 'Die übertragene Datei ist zu groß.');
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return bytes;
  } finally {
    signal.removeEventListener('abort', abort);
    reader.releaseLock();
  }
}

function imageType(bytes: Uint8Array): 'jpeg' | 'webp' | null {
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'jpeg';
  if (bytes.length >= 12 && Buffer.from(bytes.subarray(0, 4)).toString() === 'RIFF'
    && Buffer.from(bytes.subarray(8, 12)).toString() === 'WEBP') return 'webp';
  return null;
}

/** Full decode/re-encode rejects broken/animated images and discards EXIF/GPS metadata. */
async function sanitizeImage(bytes: Uint8Array, edge: number, status: number): Promise<Buffer> {
  if (!imageType(bytes)) throw new HttpError(status, 'Erwartet wird eine gültige JPEG- oder WebP-Bilddatei.');
  try {
    const image = sharp(bytes, { limitInputPixels: MAX_PIXELS, failOn: 'warning' }).timeout({ seconds: 5 });
    const meta = await image.metadata();
    if (!meta.width || !meta.height || meta.width * meta.height > MAX_PIXELS
      || (meta.pages ?? 1) !== 1 || (meta.format !== 'jpeg' && meta.format !== 'webp')) {
      throw new Error('Unsupported image');
    }
    const output = await image.rotate().resize({ width: edge, height: edge, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' }).jpeg({ quality: 85 }).toBuffer();
    if (output.byteLength > (status === 400 ? MAX_FILE_BYTES : MAX_BODY_BYTES)) throw new Error('Image too large');
    return output;
  } catch {
    throw new HttpError(status, 'Das Bild ist beschädigt, animiert oder zu groß. Bitte ein anderes Bild verwenden.');
  }
}

async function uploadBody(request: Request): Promise<FormData> {
  const type = request.headers.get('content-type') ?? '';
  if (!/^multipart\/form-data\s*;/i.test(type) || type.length > 256) {
    throw new HttpError(400, 'Erwartet werden genau zwei Bilddateien als multipart/form-data.');
  }
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(10_000)]);
  const bytes = await readLimited(request, MAX_BODY_BYTES, signal, 413);
  let form: FormData;
  try { form = await new Response(bytes, { headers: { 'content-type': type } }).formData(); }
  catch { throw new HttpError(400, 'Die Bilddateien konnten nicht gelesen werden.'); }
  if ([...form.entries()].length !== 2 || form.getAll('Bild1').length !== 1 || form.getAll('Bild2').length !== 1) {
    throw new HttpError(400, 'Bitte genau Bild1 und Bild2 ohne weitere Felder senden.');
  }
  const sanitized = new FormData();
  for (const field of ['Bild1', 'Bild2']) {
    signal.throwIfAborted();
    const file = form.get(field);
    if (!(file instanceof Blob) || !file.size || file.size > MAX_FILE_BYTES
      || !['image/jpeg', 'image/webp'].includes(file.type)) {
      throw new HttpError(400, 'Jedes Bild muss eine JPEG- oder WebP-Datei bis 2 MiB sein.');
    }
    const input = new Uint8Array(await file.arrayBuffer());
    const detected = imageType(input);
    if (!detected || `image/${detected}` !== file.type) throw new HttpError(400, 'Bildformat und Dateiinhalt stimmen nicht überein.');
    const output = await sanitizeImage(input, 2048, 400);
    sanitized.append(field, new Blob([new Uint8Array(output)], { type: 'image/jpeg' }), `${field}.jpg`);
  }
  signal.throwIfAborted();
  return sanitized;
}

async function quotaRpc(config: ServerConfig, name: string, args: Record<string, string>): Promise<unknown> {
  // Supabase secret keys are API keys, not JWTs. Legacy service-role JWTs also work.
  const response = await fetch(`${config.supabaseUrl}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: config.secretKey,
      ...(config.secretKey.startsWith('eyJ') ? { Authorization: `Bearer ${config.secretKey}` } : {}),
      'content-type': 'application/json',
    },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(5_000),
    redirect: 'error',
  });
  if (!response.ok) throw new Error('Quota storage unavailable');
  return response.json();
}

export async function POST(request: Request): Promise<Response> {
  let config: ServerConfig | undefined;
  let reservation: string | undefined;
  let releaseReservation = false;
  try {
    if (request.method !== 'POST') return new Response(null, { status: 405, headers: { allow: 'POST' } });
    config = readConfig();
    const userId = await signedInUser(request, config);
    request.signal.throwIfAborted();
    const requestId = randomUUID();
    let quota: unknown;
    try { quota = await quotaRpc(config, 'reserve_generation', { p_user_id: userId, p_request_id: requestId }); }
    catch { throw new HttpError(503, 'Der Nutzungsschutz ist gerade nicht verfügbar. Bitte später erneut versuchen.'); }
    if (!quota || typeof quota !== 'object' || !('allowed' in quota) || typeof quota.allowed !== 'boolean') {
      throw new HttpError(503, 'Der Nutzungsschutz ist gerade nicht verfügbar.');
    }
    if (!quota.allowed) {
      const retry = 'retry_after' in quota && typeof quota.retry_after === 'number'
        ? Math.max(1, Math.min(86400, Math.ceil(quota.retry_after))) : 60;
      return fail(429, 'Das Nutzungslimit wurde erreicht oder es läuft bereits eine Generierung. Bitte später erneut versuchen.', retry);
    }
    reservation = requestId;
    releaseReservation = true;
    const body = await uploadBody(request);
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)]);
    signal.throwIfAborted();
    // After dispatch, a network error does not prove that n8n stopped processing.
    // Keep the 10-minute lease in that case to prevent overlapping paid jobs.
    releaseReservation = false;
    const upstream = await fetch(config.webhookUrl, {
      method: 'POST', headers: new Headers([config.authHeader]), body, signal, redirect: 'error',
    });
    if (!upstream.ok) {
      await upstream.body?.cancel();
      throw new HttpError(502, 'Die Bildgenerierung ist beim externen Dienst fehlgeschlagen. Bitte später erneut versuchen.');
    }
    const type = upstream.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
    if (!type || !['image/jpeg', 'image/webp'].includes(type)) {
      await upstream.body?.cancel();
      throw new HttpError(502, 'Der externe Dienst hat keine unterstützte Bilddatei geliefert.');
    }
    const bytes = await readLimited(upstream, MAX_BODY_BYTES, signal, 502);
    releaseReservation = true;
    if (`image/${imageType(bytes)}` !== type) throw new HttpError(502, 'Die Bildantwort ist ungültig.');
    const output = await sanitizeImage(bytes, 4096, 502);
    signal.throwIfAborted();
    return new Response(new Uint8Array(output), {
      headers: { 'content-type': 'image/jpeg', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
    });
  } catch (error) {
    if (request.signal.aborted) return fail(499, 'Die Anfrage wurde abgebrochen.');
    if (error instanceof HttpError) return fail(error.status, error.message);
    if (error instanceof Error && error.name === 'TimeoutError') return fail(504, 'Die Verarbeitung hat zu lange gedauert.');
    return fail(502, 'Die Bildgenerierung ist gerade nicht verfügbar. Bitte später erneut versuchen.');
  } finally {
    if (config && reservation && releaseReservation) {
      await quotaRpc(config, 'release_generation', { p_request_id: reservation }).catch(() => {
        console.error('[generate] Could not release quota lease');
      });
    }
  }
}
