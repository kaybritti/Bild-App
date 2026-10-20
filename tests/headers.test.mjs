import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

test('production headers restrict scripts, framing and network destinations', async () => {
  const config = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));
  const headers = Object.fromEntries(config.headers[0].headers.map(h => [h.key.toLowerCase(), h.value]));
  const csp = headers['content-security-policy'];
  assert.ok(csp.includes("script-src 'self'"));
  assert.ok(csp.includes("style-src 'self'"));
  assert.ok(csp.includes("frame-ancestors 'none'"));
  assert.ok(csp.includes("object-src 'none'"));
  assert.ok(csp.includes("img-src 'self' blob:"));
  // Only Cloudflare Turnstile (CAPTCHA) may load scripts or frames from elsewhere.
  assert.match(csp, /script-src 'self' https:\/\/challenges\.cloudflare\.com;/);
  assert.match(csp, /frame-src https:\/\/challenges\.cloudflare\.com;/);
  assert.ok(!csp.includes('unsafe-inline') && !csp.includes('unsafe-eval') && !csp.includes('*'));
  assert.equal(headers['x-content-type-options'], 'nosniff');
  assert.equal(headers['x-frame-options'], 'DENY');
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.ok(!html.includes('fonts.googleapis.com') && !html.includes('fonts.gstatic.com'));
});
