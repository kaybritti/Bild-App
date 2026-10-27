import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const migration = name => readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');

test('subscription migration: permissions, entitlement, trial and period quota, webhook sync', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create schema auth;
      create table auth.users(id uuid primary key, email_confirmed_at timestamptz);
      insert into auth.users values
        ('00000000-0000-4000-8000-000000000001', now()),
        ('00000000-0000-4000-8000-000000000002', now());
    `);
    await db.exec(await migration('202610200001_generation_limits.sql'));
    await db.exec(await migration('202610200002_subscriptions.sql'));
    // Isolate the subscription rules from the daily/cooldown limits tested in quota.test.mjs.
    await db.exec('update private.generation_limits set user_daily = 1000, global_daily = 10000, global_concurrent = 100, cooldown_seconds = 1, trial_quota = 2');
    const user = '00000000-0000-4000-8000-000000000001';
    const user2 = '00000000-0000-4000-8000-000000000002';
    let sequence = 0;
    const reserve = async (id = user) => {
      const requestId = `10000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`;
      const { rows } = await db.query('select public.reserve_generation($1, $2) as result', [id, requestId]);
      // Leases and cooldown are not under test here.
      await db.exec('reset role');
      await db.exec('update private.generation_requests set completed_at = now(), started_at = started_at - interval \'2 seconds\'');
      await db.exec('set role service_role');
      return rows[0].result;
    };
    const status = async (id = user) => (await db.query('select public.billing_status($1) as r', [id])).rows[0].r;
    const sync = (customer, subscription, state, start, end, cancel = false, quota = 100, trial = false) => db.query(
      'select public.sync_stripe_subscription($1, $2, $3, $4, $5, $6, $7, $8) as r',
      [customer, subscription, state, start, end, cancel, quota, trial],
    ).then(r => r.rows[0].r);

    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`);
      await assert.rejects(db.query('select public.billing_status($1)', [user]), /permission denied/);
      await assert.rejects(db.query('select public.link_stripe_customer($1, $2)', [user, 'cus_A']), /permission denied/);
      await assert.rejects(sync('cus_A', 'sub_A', 'active', null, null), /permission denied/);
      await assert.rejects(db.query('select * from private.subscriptions'), /permission denied/);
      await db.exec('reset role');
    }

    await db.exec('set role service_role');
    assert.deepEqual(await reserve(), { allowed: false, reason: 'subscription' }, 'no subscription, no generation');
    assert.equal((await status()).trial_available, true);

    await assert.rejects(db.query('select public.link_stripe_customer($1, $2)', [user, 'not-a-customer']), /Invalid customer link/);
    assert.equal((await db.query('select public.link_stripe_customer($1, $2) as r', [user, 'cus_A'])).rows[0].r.customer_id, 'cus_A');
    assert.equal((await db.query('select public.link_stripe_customer($1, $2) as r', [user, 'cus_B'])).rows[0].r.customer_id, 'cus_A',
      'a racing second customer does not replace the first');
    assert.equal((await sync('cus_unknown', 'sub_X', 'active', null, null)).applied, false);

    const now = Date.now();
    const iso = ms => new Date(ms).toISOString();
    const day = 86_400_000;
    assert.equal((await sync('cus_A', 'sub_1', 'trialing', iso(now - day), iso(now + 6 * day), false, 100, true)).applied, true);
    assert.equal((await status()).trial_available, false);
    assert.equal((await status()).allowance, 2, 'trial uses the smaller trial quota');
    assert.equal((await reserve()).allowed, true);
    assert.equal((await reserve()).allowed, true);
    const exhausted = await reserve();
    assert.equal(exhausted.reason, 'period_quota');
    assert.ok(exhausted.retry_after > 5 * 86400 && exhausted.retry_after <= 6 * 86400);
    assert.equal((await reserve(user2)).reason, 'subscription', 'other users are not entitled');

    // Trial converts: new billing period, usage restarts, full monthly quota.
    await sync('cus_A', 'sub_1', 'active', iso(now), iso(now + 30 * day));
    assert.deepEqual([(await status()).used, (await status()).allowance], [0, 100]);
    assert.equal((await reserve()).allowed, true);
    assert.equal((await status()).used, 1);

    await sync('cus_A', 'sub_1', 'past_due', iso(now), iso(now + 30 * day));
    assert.equal((await reserve()).reason, 'subscription', 'failed payment blocks generation');
    await sync('cus_A', 'sub_1', 'active', iso(now), iso(now - 1000));
    assert.equal((await reserve()).reason, 'subscription', 'an expired period blocks generation');

    // A new subscription is not overwritten by a late event of the ended old one.
    await sync('cus_A', 'sub_1', 'canceled', iso(now - 30 * day), iso(now));
    await sync('cus_A', 'sub_2', 'active', iso(now), iso(now + 30 * day));
    assert.equal((await sync('cus_A', 'sub_1', 'canceled', iso(now - 30 * day), iso(now))).applied, false);
    assert.equal((await status()).status, 'active');
    assert.equal((await reserve()).allowed, true);

    await db.exec('reset role');
    await db.exec('update private.generation_limits set enabled = false');
    await db.exec('set role service_role');
    assert.equal((await reserve()).allowed, false, 'the global switch still wins');
  } finally {
    await db.close();
  }
});
