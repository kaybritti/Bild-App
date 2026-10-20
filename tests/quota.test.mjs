import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('database quota migration: permissions, concurrency leases, cooldown, daily caps and fail-closed switch', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create schema auth;
      create table auth.users(id uuid primary key, email_confirmed_at timestamptz);
      insert into auth.users values
        ('00000000-0000-4000-8000-000000000001', now()),
        ('00000000-0000-4000-8000-000000000002', now()),
        ('00000000-0000-4000-8000-000000000003', null);
    `);
    await db.exec(await readFile(new URL('../supabase/migrations/202610200001_generation_limits.sql', import.meta.url), 'utf8'));
    const user = '00000000-0000-4000-8000-000000000001';
    const user2 = '00000000-0000-4000-8000-000000000002';
    let sequence = 0;
    const reserve = async (id = user) => {
      const requestId = `10000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`;
      const result = await db.query('select public.reserve_generation($1, $2) as result', [id, requestId]);
      return { ...result.rows[0].result, requestId };
    };
    const clear = () => db.exec('truncate private.generation_requests');
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`);
      await assert.rejects(reserve(), /permission denied/);
      await assert.rejects(db.query('select public.release_generation($1)', [user]), /permission denied/);
      await assert.rejects(db.query('select * from private.generation_requests'), /permission denied/);
      await db.exec('reset role');
    }
    await db.exec('set role service_role');
    const first = await reserve();
    assert.equal(first.allowed, true);
    assert.equal((await reserve()).allowed, false, 'one active lease per user');
    await db.query('select public.release_generation($1)', [first.requestId]);
    assert.equal((await reserve()).allowed, false, 'cooldown applies after release');
    await db.exec('reset role');
    await db.exec("update private.generation_requests set started_at = now() - interval '61 seconds'");
    assert.equal((await reserve()).allowed, true);
    await clear();

    await db.exec('update private.generation_limits set global_concurrent = 1');
    assert.equal((await reserve()).allowed, true);
    assert.equal((await reserve(user2)).allowed, false, 'global concurrency limit');
    await db.exec("update private.generation_requests set lease_expires_at = now() - interval '1 second'");
    assert.equal((await reserve(user2)).allowed, true, 'abandoned lease expires');
    await clear();

    await db.exec('update private.generation_limits set global_concurrent = 5, user_daily = 1');
    const attempt = await reserve();
    await db.query('select public.release_generation($1)', [attempt.requestId]);
    const limited = await reserve();
    assert.equal(limited.allowed, false, 'daily user limit includes finished attempts');
    assert.ok(limited.retry_after > 0 && limited.retry_after <= 86400);
    assert.equal((await reserve(user2)).allowed, true);
    await clear();

    await db.exec('update private.generation_limits set user_daily = 10, global_daily = 1');
    assert.equal((await reserve()).allowed, true);
    assert.equal((await reserve(user2)).allowed, false, 'global daily budget');
    await clear();
    await db.exec('update private.generation_limits set enabled = false');
    assert.equal((await reserve()).allowed, false, 'operator kill switch');
    await db.exec('update private.generation_limits set enabled = true');
    await assert.rejects(reserve('00000000-0000-4000-8000-000000000003'), /Confirmed user required/);
  } finally { await db.close(); }
});
