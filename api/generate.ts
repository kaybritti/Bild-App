/**
 * Vercel-Serverfunktion (POST /api/generate): geschützter Proxy zum n8n-Webhook.
 *
 * 1. Prüft das Supabase-Login (Bearer-Token aus dem Browser).
 * 2. Leitet den Multipart-Body (Bild1, Bild2) unverändert an n8n weiter und ergänzt
 *    dabei serverseitig die Webhook-Zugangsdaten – sie gelangen nie in den Browser.
 * 3. Gibt die Bildantwort von n8n unverändert zurück.
 *
 * Lokal führt der Vite-Dev-Server diese Funktion ebenfalls aus (siehe vite.config.ts).
 * Bewusst ohne relative Imports, damit Vercel die Datei eigenständig bündeln kann.
 */

/** Vercel nimmt pro Anfrage höchstens 4,5 MB an; der Browser verkleinert Fotos entsprechend. */
const MAX_BODY_BYTES = 4_500_000;

/** Etwas kürzer als maxDuration in vercel.json, damit noch eine saubere Fehlermeldung möglich ist. */
const UPSTREAM_TIMEOUT_MS = 170_000;

interface ServerConfig {
  webhookUrl: string;
  supabaseUrl: string;
  supabaseKey: string;
  authHeader: [name: string, value: string] | null;
}

function env(...names: string[]): string {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return '';
}

/** Header Auth (Name + Wert) oder Basic Auth (Benutzer + Passwort) – je nach Einstellung im Webhook-Knoten. */
function readAuthHeader(): [string, string] | null {
  const headerName = env('N8N_AUTH_HEADER_NAME');
  const headerValue = env('N8N_AUTH_HEADER_VALUE');
  if (headerName && headerValue) return [headerName, headerValue];

  const user = env('N8N_BASIC_AUTH_USER');
  const password = env('N8N_BASIC_AUTH_PASSWORD');
  if (user && password) return ['Authorization', `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`];

  return null;
}

function readConfig(): ServerConfig | null {
  const webhookUrl = env('N8N_WEBHOOK_URL');
  const supabaseUrl = env('SUPABASE_URL', 'VITE_SUPABASE_URL');
  const supabaseKey = env('SUPABASE_PUBLISHABLE_KEY', 'VITE_SUPABASE_PUBLISHABLE_KEY');
  if (!webhookUrl || !supabaseUrl || !supabaseKey) return null;
  return { webhookUrl, supabaseUrl: supabaseUrl.replace(/\/+$/, ''), supabaseKey, authHeader: readAuthHeader() };
}

/** Fehlerantwort mit einer Nachricht, die der Browser direkt anzeigt. */
function fail(status: number, error: string): Response {
  return Response.json({ error }, { status, headers: { 'cache-control': 'no-store' } });
}

async function isSignedIn(request: Request, config: ServerConfig): Promise<boolean | 'unavailable'> {
  const token = /^Bearer\s+(\S+)$/i.exec(request.headers.get('authorization') ?? '')?.[1];
  if (!token) return false;
  try {
    const response = await fetch(`${config.supabaseUrl}/auth/v1/user`, {
      headers: { apikey: config.supabaseKey, Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (response.ok) return true;
    return response.status === 401 || response.status === 403 ? false : 'unavailable';
  } catch {
    return 'unavailable';
  }
}

function messageForN8nStatus(status: number, webhookUrl: string): string {
  if (status === 404) {
    return webhookUrl.includes('/webhook-test/')
      ? 'Der n8n-Test-Webhook ist nicht aktiv (HTTP 404). In n8n zuerst „Execute workflow“ klicken.'
      : 'Der n8n-Workflow ist nicht erreichbar (HTTP 404). Bitte prüfen, ob der Workflow in n8n aktiviert ist.';
  }
  if (status === 401 || status === 403) {
    return `n8n hat die Zugangsdaten des Servers abgelehnt (HTTP ${status}). Bitte die Webhook-Zugangsdaten prüfen.`;
  }
  if (status === 413) {
    return 'Die Bilder sind zu groß für den n8n-Webhook (HTTP 413). Bitte kleinere Dateien verwenden.';
  }
  if (status === 429) {
    return 'Zu viele Anfragen an n8n (HTTP 429). Bitte einen Moment warten und erneut versuchen.';
  }
  if (status >= 500) {
    return `Im n8n-Workflow ist ein Fehler aufgetreten (HTTP ${status}). Bitte später erneut versuchen.`;
  }
  return `Der n8n-Workflow konnte die Bilder nicht verarbeiten (HTTP ${status}).`;
}

export async function POST(request: Request): Promise<Response> {
  const config = readConfig();
  if (!config) {
    return fail(500, 'Der Server ist nicht vollständig konfiguriert. Bitte N8N_WEBHOOK_URL und die Supabase-Werte setzen.');
  }

  const signedIn = await isSignedIn(request, config);
  if (signedIn === 'unavailable') {
    return fail(503, 'Die Anmeldung konnte gerade nicht geprüft werden. Bitte erneut versuchen.');
  }
  if (!signedIn) {
    return fail(401, 'Deine Sitzung ist abgelaufen. Bitte melde dich erneut an.');
  }

  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().startsWith('multipart/form-data')) {
    return fail(400, 'Ungültige Anfrage: Erwartet werden die Bilder als multipart/form-data.');
  }
  const declaredLength = Number(request.headers.get('content-length') ?? 0);
  if (declaredLength > MAX_BODY_BYTES) {
    return fail(413, 'Die Bilder sind zusammen zu groß (max. 4,5 MB). Bitte kleinere Dateien verwenden.');
  }
  const body = await request.arrayBuffer();
  if (body.byteLength > MAX_BODY_BYTES) {
    return fail(413, 'Die Bilder sind zusammen zu groß (max. 4,5 MB). Bitte kleinere Dateien verwenden.');
  }

  // Content-Type mit Boundary unverändert übernehmen, damit n8n die Felder Bild1/Bild2 erkennt.
  const headers = new Headers({ 'content-type': contentType });
  if (config.authHeader) headers.set(...config.authHeader);

  let upstream: Response;
  try {
    upstream = await fetch(config.webhookUrl, {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'TimeoutError';
    return timedOut
      ? fail(504, 'Die Generierung hat zu lange gedauert. Bitte erneut versuchen.')
      : fail(502, 'Der n8n-Workflow ist nicht erreichbar. Bitte später erneut versuchen.');
  }

  if (!upstream.ok) {
    return fail(502, messageForN8nStatus(upstream.status, config.webhookUrl));
  }

  // Inhalt und Content-Type unverändert zurückgeben – der Browser prüft das Bild selbst.
  return new Response(await upstream.arrayBuffer(), {
    status: 200,
    headers: {
      'content-type': upstream.headers.get('content-type') ?? 'application/octet-stream',
      'cache-control': 'no-store',
    },
  });
}
