const STRIPE_API = 'https://api.stripe.com/v1';
/** Lookup key of the monthly price in Stripe (Dashboard → Product → Price → Lookup key). */
const PRICE_LOOKUP_KEY = 'studio_monthly';
const TRIAL_DAYS = 7;
const RUNNING = ['active', 'trialing', 'past_due', 'unpaid'];

interface ServerConfig {
  supabaseUrl: string;
  supabaseKey: string;
  secretKey: string;
  stripeKey: string;
}

interface SignedInUser {
  id: string;
  email: string;
}

interface BillingRow {
  customer_id: string | null;
  status: string | null;
  period_end?: string | null;
  cancel_at_period_end?: boolean;
  allowance?: number;
  used?: number;
  trial_available: boolean;
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
  const supabaseUrl = env('SUPABASE_URL', 'VITE_SUPABASE_URL');
  const supabaseKey = env('SUPABASE_PUBLISHABLE_KEY', 'VITE_SUPABASE_PUBLISHABLE_KEY');
  const secretKey = env('SUPABASE_SECRET_KEY');
  const stripeKey = env('STRIPE_SECRET_KEY');
  if (!supabaseUrl || !supabaseKey || !secretKey || !/^(sk|rk)_(test|live)_/.test(stripeKey)) {
    throw new HttpError(503, 'Die Abo-Verwaltung ist noch nicht konfiguriert. Bitte den Betreiber kontaktieren.');
  }
  if (new URL(supabaseUrl).protocol !== 'https:') {
    throw new HttpError(503, 'Die Abo-Verwaltung ist nicht verfügbar. Bitte den Betreiber kontaktieren.');
  }
  return { supabaseUrl: supabaseUrl.replace(/\/+$/, ''), supabaseKey, secretKey, stripeKey };
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
  });
}

async function signedInUser(request: Request, config: ServerConfig): Promise<SignedInUser> {
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
      || !('email' in user) || typeof user.email !== 'string' || !user.email
      || !('email_confirmed_at' in user) || !user.email_confirmed_at
      || ('is_anonymous' in user && user.is_anonymous === true)) {
      throw new HttpError(401, 'Bitte melde dich mit einem bestätigten E-Mail-Konto an.');
    }
    return { id: user.id, email: user.email };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(503, 'Die Anmeldung konnte gerade nicht geprüft werden. Bitte erneut versuchen.');
  }
}

async function rpc(config: ServerConfig, name: string, args: Record<string, string>): Promise<unknown> {
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
  if (!response.ok) throw new HttpError(503, 'Die Abo-Daten sind gerade nicht verfügbar. Bitte später erneut versuchen.');
  return response.json();
}

async function stripe(
  config: ServerConfig, method: 'GET' | 'POST', path: string,
  params: Record<string, string> = {}, idempotencyKey?: string,
): Promise<Record<string, unknown>> {
  const query = new URLSearchParams(params).toString();
  const response = await fetch(`${STRIPE_API}/${path}${method === 'GET' && query ? `?${query}` : ''}`, {
    method,
    headers: {
      Authorization: `Bearer ${config.stripeKey}`,
      ...(method === 'POST' ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
      ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
    },
    body: method === 'POST' ? query : undefined,
    signal: AbortSignal.timeout(10_000),
    redirect: 'error',
  });
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok || !data || typeof data !== 'object') {
    console.error(`[billing] Stripe ${method} ${path} failed with HTTP ${response.status}`);
    throw new HttpError(502, 'Der Zahlungsdienst ist gerade nicht erreichbar. Bitte später erneut versuchen.');
  }
  return data as Record<string, unknown>;
}

async function billingRow(config: ServerConfig, userId: string): Promise<BillingRow> {
  const row = await rpc(config, 'billing_status', { p_user_id: userId });
  if (!row || typeof row !== 'object' || !('trial_available' in row)) {
    throw new HttpError(503, 'Die Abo-Daten sind gerade nicht verfügbar.');
  }
  return row as BillingRow;
}

/** Each user gets exactly one Stripe customer; the database keeps the first one on a race. */
async function ensureCustomer(config: ServerConfig, user: SignedInUser, row: BillingRow): Promise<string> {
  if (row.customer_id) return row.customer_id;
  const customer = await stripe(config, 'POST', 'customers', {
    email: user.email,
    'metadata[supabase_user_id]': user.id,
  }, `customer-${user.id}`);
  if (typeof customer.id !== 'string') throw new HttpError(502, 'Der Zahlungsdienst hat ungültig geantwortet.');
  const linked = await rpc(config, 'link_stripe_customer', { p_user_id: user.id, p_customer_id: customer.id });
  if (!linked || typeof linked !== 'object' || !('customer_id' in linked) || typeof linked.customer_id !== 'string') {
    throw new HttpError(503, 'Die Abo-Daten sind gerade nicht verfügbar.');
  }
  return linked.customer_id;
}

async function priceId(config: ServerConfig): Promise<string> {
  const prices = await stripe(config, 'GET', 'prices', { 'lookup_keys[]': PRICE_LOOKUP_KEY, active: 'true', limit: '1' });
  const price = Array.isArray(prices.data) ? prices.data[0] as { id?: unknown } | undefined : undefined;
  if (typeof price?.id !== 'string') {
    console.error(`[billing] No active Stripe price with lookup key "${PRICE_LOOKUP_KEY}"`);
    throw new HttpError(503, 'Das Abo ist gerade nicht buchbar. Bitte den Betreiber kontaktieren.');
  }
  return price.id;
}

function appOrigin(request: Request): string {
  const configured = env('APP_URL').replace(/\/+$/, '');
  return configured || new URL(request.url).origin;
}

/** Abo-Status für die Oberfläche (ohne Stripe-IDs). */
export async function GET(request: Request): Promise<Response> {
  try {
    const config = readConfig();
    const user = await signedInUser(request, config);
    const row = await billingRow(config, user.id);
    return json({
      status: row.status,
      periodEnd: row.period_end ?? null,
      cancelAtPeriodEnd: row.cancel_at_period_end ?? false,
      allowance: row.allowance ?? 0,
      used: row.used ?? 0,
      trialAvailable: row.trial_available,
      canManage: row.customer_id !== null && row.status !== null,
    });
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.message }, error.status);
    return json({ error: 'Die Abo-Daten sind gerade nicht verfügbar.' }, 502);
  }
}

/** { action: "checkout" } startet Stripe Checkout, { action: "portal" } das Kundenportal. */
export async function POST(request: Request): Promise<Response> {
  try {
    if (!/^application\/json\s*(;|$)/i.test(request.headers.get('content-type') ?? '')
      || Number(request.headers.get('content-length') ?? 0) > 1024) {
      return json({ error: 'Ungültige Anfrage.' }, 400);
    }
    const config = readConfig();
    const user = await signedInUser(request, config);
    let action: unknown;
    try { action = ((await request.json()) as { action?: unknown } | null)?.action; }
    catch { return json({ error: 'Ungültige Anfrage.' }, 400); }
    const row = await billingRow(config, user.id);
    const origin = appOrigin(request);

    if (action === 'portal') {
      if (!row.customer_id) return json({ error: 'Es gibt noch kein Abo zum Verwalten.' }, 409);
      const session = await stripe(config, 'POST', 'billing_portal/sessions', {
        customer: row.customer_id,
        return_url: `${origin}/`,
        locale: 'de',
      });
      return json({ url: session.url });
    }

    if (action === 'checkout') {
      if (row.status && RUNNING.includes(row.status)) {
        return json({ error: 'Du hast bereits ein Abo. Du kannst es über „Abo verwalten“ ändern.' }, 409);
      }
      const customer = await ensureCustomer(config, user, row);
      const session = await stripe(config, 'POST', 'checkout/sessions', {
        mode: 'subscription',
        customer,
        client_reference_id: user.id,
        'line_items[0][price]': await priceId(config),
        'line_items[0][quantity]': '1',
        'subscription_data[metadata][supabase_user_id]': user.id,
        ...(row.trial_available ? { 'subscription_data[trial_period_days]': String(TRIAL_DAYS) } : {}),
        'automatic_tax[enabled]': 'true',
        'customer_update[address]': 'auto',
        'customer_update[name]': 'auto',
        billing_address_collection: 'required',
        locale: 'de',
        success_url: `${origin}/?checkout=success`,
        cancel_url: `${origin}/?checkout=cancel`,
      });
      return json({ url: session.url });
    }

    return json({ error: 'Ungültige Anfrage.' }, 400);
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.message }, error.status);
    return json({ error: 'Der Zahlungsdienst ist gerade nicht erreichbar. Bitte später erneut versuchen.' }, 502);
  }
}
