import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test, beforeEach, afterEach } from 'node:test';
import * as billing from '../api/billing.ts';
import * as webhook from '../api/stripe-webhook.ts';

const userId = '00000000-0000-4000-8000-000000000001';
const webhookSecret = 'whsec_test_secret';
let calls;
let fetchBefore;
let envBefore;
let statusReply;
let subscriptionReply;
let syncReply;

beforeEach(() => {
  fetchBefore = globalThis.fetch;
  envBefore = { ...process.env };
  Object.assign(process.env, {
    SUPABASE_URL: 'https://auth.example', SUPABASE_PUBLISHABLE_KEY: 'test-public', SUPABASE_SECRET_KEY: 'sb_secret_test',
    STRIPE_SECRET_KEY: 'sk_test_123', STRIPE_WEBHOOK_SECRET: webhookSecret,
  });
  delete process.env.APP_URL;
  calls = [];
  statusReply = { customer_id: null, status: null, trial_available: true };
  subscriptionReply = {
    id: 'sub_1', customer: 'cus_1', status: 'trialing', cancel_at_period_end: false, cancel_at: null, trial_start: 1,
    items: { data: [{ current_period_start: 1_800_000_000, current_period_end: 1_800_604_800, price: { metadata: { monthly_generations: '100' } } }] },
  };
  syncReply = { applied: true };
  globalThis.fetch = async (url, options = {}) => {
    const href = String(url);
    calls.push({ url: href, options });
    if (href.endsWith('/auth/v1/user')) return Response.json({ id: userId, email: 'kunde@example.com', email_confirmed_at: '2026-01-01T00:00:00Z' });
    if (href.endsWith('/rpc/billing_status')) return Response.json(statusReply);
    if (href.endsWith('/rpc/link_stripe_customer')) return Response.json({ customer_id: 'cus_1' });
    if (href.endsWith('/rpc/sync_stripe_subscription')) return Response.json(syncReply);
    if (href === 'https://api.stripe.com/v1/customers') return Response.json({ id: 'cus_1' });
    if (href.startsWith('https://api.stripe.com/v1/prices?')) return Response.json({ data: [{ id: 'price_1' }] });
    if (href === 'https://api.stripe.com/v1/checkout/sessions') return Response.json({ url: 'https://checkout.stripe.com/c/pay/cs_test' });
    if (href === 'https://api.stripe.com/v1/billing_portal/sessions') return Response.json({ url: 'https://billing.stripe.com/p/session/test' });
    if (href.startsWith('https://api.stripe.com/v1/subscriptions/')) return Response.json(subscriptionReply);
    throw new Error(`Unexpected network request ${href}`);
  };
});

afterEach(() => { globalThis.fetch = fetchBefore; process.env = envBefore; });

const post = body => new Request('https://studio.example/api/billing', {
  method: 'POST', headers: { Authorization: 'Bearer test-token', 'content-type': 'application/json' }, body: JSON.stringify(body),
});
const stripeCall = path => calls.find(c => c.url === `https://api.stripe.com/v1/${path}`);

test('checkout creates one customer and a 7-day trial subscription session with automatic tax', async () => {
  const response = await billing.POST(post({ action: 'checkout' }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).url, 'https://checkout.stripe.com/c/pay/cs_test');
  const customer = stripeCall('customers');
  assert.equal(customer.options.headers['idempotency-key'], `customer-${userId}`);
  assert.equal(new URLSearchParams(customer.options.body).get('metadata[supabase_user_id]'), userId);
  const session = new URLSearchParams(stripeCall('checkout/sessions').options.body);
  assert.equal(session.get('mode'), 'subscription');
  assert.equal(session.get('customer'), 'cus_1');
  assert.equal(session.get('line_items[0][price]'), 'price_1');
  assert.equal(session.get('subscription_data[trial_period_days]'), '7');
  assert.equal(session.get('automatic_tax[enabled]'), 'true');
  assert.equal(session.get('success_url'), 'https://studio.example/?checkout=success');
  assert.equal(stripeCall('checkout/sessions').options.headers.Authorization, 'Bearer sk_test_123');
});

test('no second trial and no second subscription', async () => {
  statusReply = { customer_id: 'cus_1', status: 'canceled', trial_available: false };
  await billing.POST(post({ action: 'checkout' }));
  assert.equal(stripeCall('customers'), undefined, 'existing customer is reused');
  assert.equal(new URLSearchParams(stripeCall('checkout/sessions').options.body).get('subscription_data[trial_period_days]'), null);

  calls = [];
  statusReply = { customer_id: 'cus_1', status: 'active', trial_available: false };
  assert.equal((await billing.POST(post({ action: 'checkout' }))).status, 409);
  assert.equal(calls.some(c => c.url.startsWith('https://api.stripe.com/')), false);
});

test('portal needs a customer; status hides Stripe IDs', async () => {
  assert.equal((await billing.POST(post({ action: 'portal' }))).status, 409);
  statusReply = { customer_id: 'cus_1', status: 'active', period_end: '2026-11-20T00:00:00Z', allowance: 100, used: 3, trial_available: false };
  assert.equal((await (await billing.POST(post({ action: 'portal' }))).json()).url, 'https://billing.stripe.com/p/session/test');
  const status = await (await billing.GET(new Request('https://studio.example/api/billing', { headers: { Authorization: 'Bearer t' } }))).json();
  assert.deepEqual(status, {
    status: 'active', periodEnd: '2026-11-20T00:00:00Z', cancelAtPeriodEnd: false, allowance: 100, used: 3,
    trialAvailable: false, canManage: true,
  });
  assert.ok(!JSON.stringify(status).includes('cus_'));
});

test('billing fails closed without auth, configuration or a JSON body', async () => {
  assert.equal((await billing.POST(new Request('https://studio.example/api/billing', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"action":"checkout"}',
  }))).status, 401);
  assert.equal((await billing.POST(new Request('https://studio.example/api/billing', {
    method: 'POST', headers: { Authorization: 'Bearer t', 'content-type': 'text/plain' }, body: 'checkout',
  }))).status, 400);
  assert.equal((await billing.POST(post({ action: 'refund' }))).status, 400);
  calls = [];
  delete process.env.STRIPE_SECRET_KEY;
  assert.equal((await billing.POST(post({ action: 'checkout' }))).status, 503);
  assert.equal(calls.length, 0);
});

function signed(event, { secret = webhookSecret, time = Math.floor(Date.now() / 1000) } = {}) {
  const payload = JSON.stringify(event);
  const signature = createHmac('sha256', secret).update(`${time}.${payload}`).digest('hex');
  return new Request('https://studio.example/api/stripe-webhook', {
    method: 'POST', headers: { 'stripe-signature': `t=${time},v1=${signature}` }, body: payload,
  });
}

test('webhook rejects forged, stale and unsigned events before any network call', async () => {
  const event = { id: 'evt_1', type: 'customer.subscription.updated', data: { object: { id: 'sub_1' } } };
  assert.equal((await webhook.POST(signed(event, { secret: 'whsec_wrong' }))).status, 400);
  assert.equal((await webhook.POST(signed(event, { time: Math.floor(Date.now() / 1000) - 600 }))).status, 400);
  assert.equal((await webhook.POST(new Request('https://studio.example/api/stripe-webhook', { method: 'POST', body: JSON.stringify(event) }))).status, 400);
  delete process.env.STRIPE_WEBHOOK_SECRET;
  assert.equal((await webhook.POST(signed(event))).status, 503);
  assert.equal(calls.length, 0);
});

test('webhook syncs a fresh subscription snapshot instead of trusting the event body', async () => {
  const event = { id: 'evt_1', type: 'checkout.session.completed', data: { object: { mode: 'subscription', subscription: 'sub_1', status: 'forged' } } };
  const response = await webhook.POST(signed(event));
  assert.equal(response.status, 200);
  assert.ok(calls.some(c => c.url.startsWith('https://api.stripe.com/v1/subscriptions/sub_1')));
  const args = JSON.parse(calls.find(c => c.url.endsWith('/rpc/sync_stripe_subscription')).options.body);
  assert.deepEqual(args, {
    p_customer_id: 'cus_1', p_subscription_id: 'sub_1', p_status: 'trialing',
    p_period_start: new Date(1_800_000_000_000).toISOString(), p_period_end: new Date(1_800_604_800_000).toISOString(),
    p_cancel_at_period_end: false, p_monthly_quota: 100, p_had_trial: true,
  });
});

test('webhook ignores unrelated events and asks Stripe to retry on storage failure', async () => {
  assert.equal((await webhook.POST(signed({ id: 'evt_2', type: 'charge.succeeded', data: { object: {} } }))).status, 200);
  assert.equal(calls.length, 0);
  globalThis.fetch = async url => String(url).includes('/rpc/') ? new Response('down', { status: 500 }) : Response.json(subscriptionReply);
  const event = { id: 'evt_3', type: 'invoice.paid', data: { object: { parent: { subscription_details: { subscription: 'sub_1' } } } } };
  assert.equal((await webhook.POST(signed(event))).status, 503);
});

test('verifySignature accepts any matching v1 entry (secret rotation)', () => {
  const time = 1_800_000_000;
  const good = createHmac('sha256', webhookSecret).update(`${time}.{}`).digest('hex');
  assert.equal(webhook.verifySignature('{}', `t=${time},v1=${'0'.repeat(64)},v1=${good}`, webhookSecret, time), true);
  assert.equal(webhook.verifySignature('{} ', `t=${time},v1=${good}`, webhookSecret, time), false);
});
