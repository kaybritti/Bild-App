import { createHmac, timingSafeEqual } from 'node:crypto';

const STRIPE_API = 'https://api.stripe.com/v1';
const MAX_BODY_BYTES = 512 * 1024;
const SIGNATURE_TOLERANCE_SECONDS = 300;
const DEFAULT_MONTHLY_QUOTA = 100;

interface ServerConfig {
  supabaseUrl: string;
  secretKey: string;
  stripeKey: string;
  webhookSecret: string;
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
  const secretKey = env('SUPABASE_SECRET_KEY');
  const stripeKey = env('STRIPE_SECRET_KEY');
  const webhookSecret = env('STRIPE_WEBHOOK_SECRET');
  if (!supabaseUrl || !secretKey || !/^(sk|rk)_(test|live)_/.test(stripeKey) || !webhookSecret.startsWith('whsec_')) {
    throw new HttpError(503, 'Webhook not configured');
  }
  return { supabaseUrl: supabaseUrl.replace(/\/+$/, ''), secretKey, stripeKey, webhookSecret };
}

/** Stripe-Signature: t=<unix>,v1=<hex hmac of "t.payload">[,v1=...]. */
export function verifySignature(payload: string, header: string, secret: string, now = Date.now() / 1000): boolean {
  const parts = header.split(',').map(part => part.split('=', 2) as [string, string | undefined]);
  const timestamp = Number(parts.find(([key]) => key === 't')?.[1]);
  if (!Number.isInteger(timestamp) || Math.abs(now - timestamp) > SIGNATURE_TOLERANCE_SECONDS) return false;
  const expected = createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest();
  return parts.some(([key, value]) => {
    if (key !== 'v1' || !value || !/^[0-9a-f]{64}$/.test(value)) return false;
    return timingSafeEqual(Buffer.from(value, 'hex'), expected);
  });
}

async function readBody(request: Request): Promise<string> {
  if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) throw new HttpError(413, 'Payload too large');
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > MAX_BODY_BYTES) throw new HttpError(413, 'Payload too large');
  return new TextDecoder().decode(bytes);
}

function idOf(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && 'id' in value && typeof value.id === 'string') return value.id;
  return null;
}

/** Finds the subscription an event refers to; other events are acknowledged and ignored. */
function subscriptionIdOf(event: { type?: unknown; data?: { object?: Record<string, unknown> } }): string | null {
  const object = event.data?.object;
  if (!object || typeof event.type !== 'string') return null;
  if (event.type.startsWith('customer.subscription.')) return idOf(object.id);
  if (event.type === 'checkout.session.completed' && object.mode === 'subscription') return idOf(object.subscription);
  if (event.type === 'invoice.paid' || event.type === 'invoice.payment_failed') {
    const parent = object.parent as { subscription_details?: { subscription?: unknown } } | null | undefined;
    return idOf(parent?.subscription_details?.subscription) ?? idOf(object.subscription);
  }
  return null;
}

async function fetchSubscription(config: ServerConfig, id: string): Promise<Record<string, unknown>> {
  if (!/^sub_[A-Za-z0-9]+$/.test(id)) throw new HttpError(400, 'Invalid subscription id');
  const response = await fetch(`${STRIPE_API}/subscriptions/${id}?expand[]=items.data.price`, {
    headers: { Authorization: `Bearer ${config.stripeKey}` },
    signal: AbortSignal.timeout(10_000),
    redirect: 'error',
  });
  if (!response.ok) throw new HttpError(502, `Stripe returned HTTP ${response.status}`);
  return response.json() as Promise<Record<string, unknown>>;
}

function isoTime(seconds: unknown): string | null {
  return typeof seconds === 'number' && Number.isFinite(seconds) ? new Date(seconds * 1000).toISOString() : null;
}

async function syncSubscription(config: ServerConfig, subscription: Record<string, unknown>): Promise<boolean> {
  const items = subscription.items as { data?: Array<Record<string, unknown>> } | undefined;
  const item = items?.data?.[0];
  const price = item?.price as { metadata?: Record<string, string> } | undefined;
  const quota = Number.parseInt(price?.metadata?.monthly_generations ?? '', 10);
  // Since API version 2025-03-31 the billing period lives on the subscription item.
  const periodStart = item?.current_period_start ?? subscription.current_period_start;
  const periodEnd = item?.current_period_end ?? subscription.current_period_end;
  const response = await fetch(`${config.supabaseUrl}/rest/v1/rpc/sync_stripe_subscription`, {
    method: 'POST',
    headers: {
      apikey: config.secretKey,
      ...(config.secretKey.startsWith('eyJ') ? { Authorization: `Bearer ${config.secretKey}` } : {}),
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      p_customer_id: idOf(subscription.customer),
      p_subscription_id: subscription.id,
      p_status: subscription.status,
      p_period_start: isoTime(periodStart),
      p_period_end: isoTime(periodEnd),
      p_cancel_at_period_end: subscription.cancel_at_period_end === true || subscription.cancel_at != null,
      p_monthly_quota: Number.isInteger(quota) ? quota : DEFAULT_MONTHLY_QUOTA,
      p_had_trial: subscription.trial_start != null,
    }),
    signal: AbortSignal.timeout(5_000),
    redirect: 'error',
  });
  if (!response.ok) throw new HttpError(503, 'Subscription storage unavailable');
  const result: unknown = await response.json();
  return !!result && typeof result === 'object' && 'applied' in result && result.applied === true;
}

/**
 * Stripe webhook. Only the signature-verified event type and subscription ID are used;
 * the subscription itself is fetched fresh from the Stripe API, so retries and event order are harmless.
 * Non-2xx answers make Stripe retry the delivery.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const config = readConfig();
    const payload = await readBody(request);
    if (!verifySignature(payload, request.headers.get('stripe-signature') ?? '', config.webhookSecret)) {
      return Response.json({ error: 'Invalid signature' }, { status: 400 });
    }
    let event: { id?: unknown; type?: unknown; data?: { object?: Record<string, unknown> } };
    try { event = JSON.parse(payload); } catch { return Response.json({ error: 'Invalid payload' }, { status: 400 }); }
    const subscriptionId = subscriptionIdOf(event);
    if (!subscriptionId) return Response.json({ received: true });
    const applied = await syncSubscription(config, await fetchSubscription(config, subscriptionId));
    if (!applied) console.warn(`[stripe-webhook] ${String(event.type)} for unknown customer or superseded subscription`);
    return Response.json({ received: true });
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    console.error(`[stripe-webhook] ${error instanceof Error ? error.message : 'Unknown error'}`);
    return Response.json({ error: 'Webhook failed' }, { status });
  }
}
