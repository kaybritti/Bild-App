begin;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table private.generation_limits (
  id boolean primary key default true check (id),
  enabled boolean not null default true,
  user_daily integer not null default 10 check (user_daily between 1 and 1000),
  global_daily integer not null default 100 check (global_daily between 1 and 10000),
  global_concurrent integer not null default 5 check (global_concurrent between 1 and 100),
  cooldown_seconds integer not null default 60 check (cooldown_seconds between 1 and 86400)
);
insert into private.generation_limits (id) values (true);

create table private.generation_requests (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  started_at timestamptz not null default now(),
  lease_expires_at timestamptz not null default (now() + interval '10 minutes'),
  completed_at timestamptz
);
create index generation_requests_user_time on private.generation_requests(user_id, started_at);
create index generation_requests_time on private.generation_requests(started_at);
alter table private.generation_limits enable row level security;
alter table private.generation_requests enable row level security;
revoke all on private.generation_limits, private.generation_requests from public, anon, authenticated;

-- Only the trusted server can reserve/release. Never expose these RPCs to user JWTs.
-- The single settings-row lock serializes decisions across all server instances.
create function public.reserve_generation(p_user_id uuid, p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  limits private.generation_limits%rowtype;
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
  return jsonb_build_object('allowed', true);
end;
$$;

create function public.release_generation(p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from private.generation_limits where id = true for update;
  update private.generation_requests set completed_at = clock_timestamp()
    where id = p_request_id and completed_at is null;
  return jsonb_build_object('released', true);
end;
$$;

revoke all on function public.reserve_generation(uuid, uuid) from public, anon, authenticated;
revoke all on function public.release_generation(uuid) from public, anon, authenticated;
grant execute on function public.reserve_generation(uuid, uuid) to service_role;
grant execute on function public.release_generation(uuid) to service_role;

commit;
