import assert from 'node:assert/strict';
import { test, beforeEach, afterEach } from 'node:test';
import sharp from 'sharp';
import { POST } from '../api/generate.ts';

const userId = '00000000-0000-4000-8000-000000000001';
const jpeg = await sharp({ create: { width: 32, height: 24, channels: 3, background: 'white' } }).jpeg().toBuffer();
let calls;
let fetchBefore;
let envBefore;
let authReply;
let quotaReply;
let upstreamReply;

beforeEach(() => {
  fetchBefore = globalThis.fetch;
  envBefore = { ...process.env };
  Object.assign(process.env, {
    N8N_WEBHOOK_URL: 'https://workflow.example/webhook/test',
    N8N_AUTH_HEADER_NAME: 'X-Workflow-Key', N8N_AUTH_HEADER_VALUE: 'test-webhook-secret',
    SUPABASE_URL: 'https://auth.example', SUPABASE_PUBLISHABLE_KEY: 'test-public',
    SUPABASE_SECRET_KEY: 'sb_secret_test',
  });
  calls = [];
  authReply = () => Response.json({ id: userId, email_confirmed_at: '2026-01-01T00:00:00Z' });
  quotaReply = () => Response.json({ allowed: true });
  upstreamReply = () => new Response(jpeg, { headers: { 'content-type': 'image/jpeg' } });
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    if (String(url).endsWith('/auth/v1/user')) return authReply();
    if (String(url).endsWith('/rpc/reserve_generation')) return quotaReply();
    if (String(url).endsWith('/rpc/release_generation')) return Response.json({ released: true });
    if (String(url).startsWith('https://workflow.example/')) return upstreamReply(options);
    throw new Error('Unexpected network request');
  };
});

afterEach(() => { globalThis.fetch = fetchBefore; process.env = envBefore; });

function request(form, headers = {}, signal) {
  if (!form) {
    form = new FormData();
    form.append('Bild1', new Blob([jpeg], { type: 'image/jpeg' }), 'private-name.jpg');
    form.append('Bild2', new Blob([jpeg], { type: 'image/jpeg' }), 'private-name2.jpg');
  }
  return new Request('https://studio.example/api/generate', {
    method: 'POST', headers: { Authorization: 'Bearer test-token', ...headers }, body: form, signal,
  });
}
const dispatched = () => calls.filter(c => c.url.startsWith('https://workflow.example/'));
const released = () => calls.some(c => c.url.endsWith('/rpc/release_generation'));

test('valid images are normalized; secrets and original filenames are not forwarded', async () => {
  const response = await POST(request());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  const output = await sharp(await response.arrayBuffer()).metadata();
  assert.equal(output.format, 'jpeg');
  const sent = dispatched()[0].options;
  assert.equal(sent.headers.get('X-Workflow-Key'), 'test-webhook-secret');
  assert.equal(sent.headers.get('Authorization'), null);
  assert.equal(sent.headers.get('content-type'), null);
  assert.equal(sent.redirect, 'error');
  assert.deepEqual([...sent.body.keys()], ['Bild1', 'Bild2']);
  assert.equal(sent.body.get('Bild1').name, 'Bild1.jpg');
  assert.ok(released());
  const quota = calls.find(c => c.url.endsWith('/rpc/reserve_generation'));
  assert.equal(quota.options.headers.apikey, 'sb_secret_test');
  assert.equal(quota.options.headers.Authorization, undefined);
  assert.equal(JSON.parse(quota.options.body).p_user_id, userId);
});

test('missing quota credentials fail closed before any network call', async () => {
  delete process.env.SUPABASE_SECRET_KEY;
  assert.equal((await POST(request())).status, 503);
  assert.equal(calls.length, 0);
});

test('only POST is supported', async () => {
  assert.equal((await POST(new Request('https://studio.example/api/generate'))).status, 405);
  assert.equal(calls.length, 0);
});

test('missing bearer token is rejected', async () => {
  assert.equal((await POST(request(undefined, { Authorization: '' }))).status, 401);
  assert.equal(calls.length, 0);
});

test('invalid Supabase token cannot reach quota or n8n', async () => {
  authReply = () => new Response(null, { status: 401 });
  assert.equal((await POST(request())).status, 401);
  assert.equal(calls.length, 1);
});

test('unconfirmed and anonymous users are rejected', async () => {
  for (const user of [{ id: userId }, { id: userId, email_confirmed_at: 'yes', is_anonymous: true }]) {
    authReply = () => Response.json(user);
    assert.equal((await POST(request())).status, 401);
  }
  assert.equal(dispatched().length, 0);
});

test('unavailable or malformed quota store fails closed', async () => {
  for (const reply of [() => new Response(null, { status: 503 }), () => Response.json({ allowed: 'yes' })]) {
    quotaReply = reply;
    assert.equal((await POST(request())).status, 503);
  }
  assert.equal(dispatched().length, 0);
});

test('quota rejection has Retry-After and avoids decoding or dispatch', async () => {
  quotaReply = () => Response.json({ allowed: false, retry_after: 30 });
  const response = await POST(request());
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('retry-after'), '30');
  assert.equal(dispatched().length, 0);
  assert.equal(released(), false);
});

test('missing subscription is 402; used-up period quota is 429 until the period ends', async () => {
  quotaReply = () => Response.json({ allowed: false, reason: 'subscription' });
  const missing = await POST(request());
  assert.equal(missing.status, 402);
  assert.match((await missing.json()).error, /Abo/);
  quotaReply = () => Response.json({ allowed: false, reason: 'period_quota', retry_after: 12 * 86400 });
  const used = await POST(request());
  assert.equal(used.status, 429);
  assert.equal(used.headers.get('retry-after'), String(12 * 86400));
  assert.equal(dispatched().length, 0);
});

test('missing, duplicate, extra and text fields are rejected', async () => {
  for (const fields of [['Bild1'], ['Bild1', 'Bild1'], ['Bild1', 'Bild2', 'extra'], ['Bild1', 'wrong']]) {
    const form = new FormData();
    for (const field of fields) form.append(field, new Blob([jpeg], { type: 'image/jpeg' }), 'a.jpg');
    assert.equal((await POST(request(form))).status, 400);
  }
  const form = new FormData(); form.set('Bild1', 'text'); form.set('Bild2', 'text');
  assert.equal((await POST(request(form))).status, 400);
  assert.equal(dispatched().length, 0);
  assert.ok(released());
});

test('forged signatures, MIME mismatches, empty and oversized files are rejected', async () => {
  for (const file of [
    new Blob([new Uint8Array([255, 216, 255, 0])], { type: 'image/jpeg' }),
    new Blob([jpeg], { type: 'image/webp' }),
    new Blob([], { type: 'image/jpeg' }),
    new Blob([new Uint8Array(2 * 1024 * 1024 + 1)], { type: 'image/jpeg' }),
  ]) {
    const form = new FormData();
    form.append('Bild1', file, 'a.jpg'); form.append('Bild2', new Blob([jpeg], { type: 'image/jpeg' }), 'b.jpg');
    assert.equal((await POST(request(form))).status, 400);
  }
  assert.equal(dispatched().length, 0);
});

test('request limit also applies without Content-Length', async () => {
  const oversized = new Request('https://studio.example/api/generate', {
    method: 'POST', headers: { Authorization: 'Bearer test-token', 'content-type': 'multipart/form-data; boundary=test' },
    body: new Uint8Array(4_500_001),
  });
  assert.equal(oversized.headers.get('content-length'), null);
  assert.equal((await POST(oversized)).status, 413);
  assert.equal(dispatched().length, 0);
});

test('pixel limit applies to highly compressed images', async () => {
  const large = await sharp({ create: { width: 4100, height: 4000, channels: 3, background: 'white' } }).jpeg().toBuffer();
  const form = new FormData();
  for (const field of ['Bild1', 'Bild2']) form.append(field, new Blob([large], { type: 'image/jpeg' }), 'large.jpg');
  assert.equal((await POST(request(form))).status, 400);
  assert.equal(dispatched().length, 0);
});

test('metadata is removed server-side and dimensions are bounded', async () => {
  const original = await sharp({ create: { width: 3000, height: 20, channels: 3, background: 'white' } })
    .withExif({ IFD0: { Artist: 'private-person' } }).jpeg().toBuffer();
  const form = new FormData();
  for (const field of ['Bild1', 'Bild2']) form.append(field, new Blob([original], { type: 'image/jpeg' }), 'original.jpg');
  assert.equal((await POST(request(form))).status, 200);
  const forwarded = dispatched()[0].options.body.get('Bild1');
  const metadata = await sharp(await forwarded.arrayBuffer()).metadata();
  assert.equal(metadata.exif, undefined);
  assert.equal(metadata.width, 2048);
});

test('unexpected upstream format and corrupted image cannot reach browser', async () => {
  for (const reply of [
    () => new Response('<script>bad</script>', { headers: { 'content-type': 'text/html' } }),
    () => new Response(new Uint8Array([255, 216, 255]), { headers: { 'content-type': 'image/jpeg' } }),
    () => new Response(jpeg, { headers: { 'content-type': 'image/webp' } }),
  ]) {
    upstreamReply = reply;
    assert.equal((await POST(request())).status, 502);
  }
});

test('oversized and interrupted upstream bodies return controlled JSON errors', async () => {
  for (const reply of [
    () => new Response(new Uint8Array(4_500_001), { headers: { 'content-type': 'image/jpeg' } }),
    () => new Response(new ReadableStream({ start(c) { c.error(new Error('broken stream')); } }),
      { headers: { 'content-type': 'image/jpeg' } }),
  ]) {
    upstreamReply = reply;
    const response = await POST(request());
    assert.equal(response.status, 502);
    assert.equal(typeof (await response.json()).error, 'string');
  }
});

test('any upstream answer releases the lease, so a failed workflow does not block retries', async () => {
  for (const reply of [
    () => new Response('workflow failed', { status: 500 }),
    () => new Response('<html></html>', { headers: { 'content-type': 'text/html' } }),
  ]) {
    calls = [];
    upstreamReply = reply;
    assert.equal((await POST(request())).status, 502);
    assert.ok(released());
  }
});

test('network timeout retains lease because remote processing may continue', async () => {
  upstreamReply = () => { throw new DOMException('timeout', 'TimeoutError'); };
  assert.equal((await POST(request())).status, 504);
  assert.equal(released(), false);
});

test('aborted requests never dispatch', async () => {
  const controller = new AbortController(); controller.abort();
  assert.equal((await POST(request(undefined, {}, controller.signal))).status, 499);
  assert.equal(dispatched().length, 0);
});

test('upstream fetch receives client cancellation', async () => {
  const controller = new AbortController();
  upstreamReply = options => {
    controller.abort();
    options.signal.throwIfAborted();
  };
  assert.equal((await POST(request(undefined, {}, controller.signal))).status, 499);
  assert.equal(released(), false);
});
