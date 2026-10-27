begin;

-- Trial periods get a smaller allowance than paid periods (cheap abuse via repeated trials).
alter table private.generation_limits
  add column trial_quota integer not null default 20 check (trial_quota between 0 and 100000);

-- One Stripe customer per user. Written only by the server (checkout) and the Stripe webhook.
create table private.subscriptions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  stripe_customer_id text not null unique,
  stripe_subscription_id text unique,
  status text,
  period_start timestamptz,
  period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  monthly_quota integer not null default 100 check (monthly_quota between 0 and 100000),
  had_trial boolean not null default false,
  used integer not null default 0,
  used_period_start timestamptz,
  updated_at timestamptz not null default now()
);
alter table private.subscriptions enable row level security;
revoke all on private.subscriptions from public, anon, authenticated;

create function private.subscription_allowance(sub private.subscriptions, limits private.generation_limits)
returns integer language sql immutable set search_path = '' as $$
  select case when sub.status = 'trialing' then least(limits.trial_quota, sub.monthly_quota) else sub.monthly_quota end;
$$;

create function private.subscription_used(sub private.subscriptions)
returns integer language sql immutable set search_path = '' as $$
  select case when sub.used_period_start is not distinct from sub.period_start then sub.used else 0 end;
$$;

-- Returns the stored customer; a concurrent second insert keeps the first one.
create function public.link_stripe_customer(p_user_id uuid, p_customer_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  customer text;
begin
  if p_user_id is null or p_customer_id is null or p_customer_id !~ '^cus_[A-Za-z0-9]+$' then
    raise exception 'Invalid customer link';
  end if;
  insert into private.subscriptions(user_id, stripe_customer_id) values (p_user_id, p_customer_id)
    on conflict (user_id) do nothing;
  select stripe_customer_id into strict customer from private.subscriptions where user_id = p_user_id;
  return jsonb_build_object('customer_id', customer);
end;
$$;

create function public.billing_status(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  limits private.generation_limits%rowtype;
  sub private.subscriptions%rowtype;
begin
  select * into strict limits from private.generation_limits where id = true;
  select * into sub from private.subscriptions where user_id = p_user_id;
  if not found then
    return jsonb_build_object('customer_id', null, 'status', null, 'trial_available', true);
  end if;
  return jsonb_build_object(
    'customer_id', sub.stripe_customer_id,
    'status', sub.status,
    'period_end', sub.period_end,
    'cancel_at_period_end', sub.cancel_at_period_end,
    'allowance', private.subscription_allowance(sub, limits),
    'used', private.subscription_used(sub),
    'trial_available', not sub.had_trial and sub.stripe_subscription_id is null);
end;
$$;

-- The webhook always passes a fresh snapshot fetched from the Stripe API, so event order does not matter.
create function public.sync_stripe_subscription(
  p_customer_id text, p_subscription_id text, p_status text, p_period_start timestamptz,
  p_period_end timestamptz, p_cancel_at_period_end boolean, p_monthly_quota integer, p_had_trial boolean
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  sub private.subscriptions%rowtype;
begin
  select * into sub from private.subscriptions where stripe_customer_id = p_customer_id for update;
  if not found then
    return jsonb_build_object('applied', false);
  end if;
  -- An ended old subscription must not overwrite a newer running one.
  if sub.stripe_subscription_id is not null and sub.stripe_subscription_id <> p_subscription_id
    and sub.status in ('active', 'trialing', 'past_due')
    and p_status not in ('active', 'trialing', 'past_due') then
    return jsonb_build_object('applied', false);
  end if;
  update private.subscriptions set
    stripe_subscription_id = p_subscription_id,
    status = p_status,
    period_start = p_period_start,
    period_end = p_period_end,
    cancel_at_period_end = coalesce(p_cancel_at_period_end, false),
    monthly_quota = greatest(0, least(100000, coalesce(p_monthly_quota, 100))),
    had_trial = sub.had_trial or coalesce(p_had_trial, false),
    updated_at = clock_timestamp()
  where user_id = sub.user_id;
  return jsonb_build_object('applied', true);
end;
$$;

-- Same as 202610200001, plus: an active or trialing subscription with remaining period allowance is required.
create or replace function public.reserve_generation(p_user_id uuid, p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  limits private.generation_limits%rowtype;
  sub private.subscriptions%rowtype;
  current_time_utc timestamptz := clock_timestamp();
  day_start timestamptz;
  last_request timestamptz;
begin
  select * into strict limits from private.generation_limits where id = true for update;
  current_time_utc := clock_timestamp();
  day_start := date_trunc('day', current_time_utc at time zone 'UTC') at time zone 'UTC';
  if not limits.enabled then
    return jsonb_build_object('allowed', false, 'retry_after', 3600);
  end if;
  if p_user_id is null or p_request_id is null or not exists (
    select 1 from auth.users where id = p_user_id and email_confirmed_at is not null
  ) then
    raise exception 'Confirmed user required';
  end if;
  select * into sub from private.subscriptions where user_id = p_user_id;
  if not found or sub.status is null or sub.status not in ('active', 'trialing')
    or sub.period_end is null or sub.period_end <= current_time_utc then
    return jsonb_build_object('allowed', false, 'reason', 'subscription');
  end if;
  if private.subscription_used(sub) >= private.subscription_allowance(sub, limits) then
    return jsonb_build_object('allowed', false, 'reason', 'period_quota', 'retry_after',
      greatest(1, ceil(extract(epoch from sub.period_end - current_time_utc))));
  end if;
  -- Metadata only, no images/tokens. Keep at most two days, cleaned on the next call.
  delete from private.generation_requests where started_at < day_start - interval '1 day';
  if (select count(*) from private.generation_requests where started_at >= day_start) >= limits.global_daily
    or (select count(*) from private.generation_requests where user_id = p_user_id and started_at >= day_start) >= limits.user_daily then
    return jsonb_build_object('allowed', false, 'retry_after',
      greatest(1, ceil(extract(epoch from day_start + interval '1 day' - current_time_utc))));
  end if;
  if exists (select 1 from private.generation_requests
    where user_id = p_user_id and completed_at is null and lease_expires_at > current_time_utc)
    or (select count(*) from private.generation_requests
      where completed_at is null and lease_expires_at > current_time_utc) >= limits.global_concurrent then
    return jsonb_build_object('allowed', false, 'retry_after', 60);
  end if;
  select max(started_at) into last_request from private.generation_requests where user_id = p_user_id;
  if last_request is not null and last_request + make_interval(secs => limits.cooldown_seconds) > current_time_utc then
    return jsonb_build_object('allowed', false, 'retry_after', greatest(1,
      ceil(extract(epoch from last_request + make_interval(secs => limits.cooldown_seconds) - current_time_utc))));
  end if;
  insert into private.generation_requests(id, user_id, started_at, lease_expires_at)
    values (p_request_id, p_user_id, current_time_utc, current_time_utc + interval '10 minutes');
  update private.subscriptions
    set used = private.subscription_used(sub) + 1, used_period_start = sub.period_start
    where user_id = p_user_id;
  return jsonb_build_object('allowed', true);
end;
$$;

revoke all on function private.subscription_allowance(private.subscriptions, private.generation_limits) from public, anon, authenticated;
revoke all on function private.subscription_used(private.subscriptions) from public, anon, authenticated;
revoke all on function public.link_stripe_customer(uuid, text) from public, anon, authenticated;
revoke all on function public.billing_status(uuid) from public, anon, authenticated;
revoke all on function public.sync_stripe_subscription(text, text, text, timestamptz, timestamptz, boolean, integer, boolean) from public, anon, authenticated;
revoke all on function public.reserve_generation(uuid, uuid) from public, anon, authenticated;
grant execute on function public.link_stripe_customer(uuid, text) to service_role;
grant execute on function public.billing_status(uuid) to service_role;
grant execute on function public.sync_stripe_subscription(text, text, text, timestamptz, timestamptz, boolean, integer, boolean) to service_role;
grant execute on function public.reserve_generation(uuid, uuid) to service_role;

commit;
