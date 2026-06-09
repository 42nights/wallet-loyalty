-- 42nights loyalty — schema
-- Run in the Supabase SQL editor (or psql). Safe to re-run: tables use
-- "create ... if not exists" and new columns use "add column if not exists",
-- so this doubles as the migration for an already-created database.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists merchants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique,                              -- public enroll path: /enroll/{slug}
  pass_type_id text,                             -- optional per-merchant override; default from env
  earn_rate numeric not null default 1,          -- points per 1 unit of currency spent
  logo_url text,                                 -- legacy/optional; branding art lives in storage
  bg_color text,                                 -- pass backgroundColor, "rgb(r,g,b)"
  fg_color text,                                 -- pass foregroundColor
  label_color text,                              -- pass labelColor
  assets_updated_at timestamptz,                 -- bumps when art changes → busts the buffer cache
  created_at timestamptz default now()
);
-- idempotent column adds for an existing database:
alter table merchants add column if not exists slug text;
alter table merchants add column if not exists earn_rate numeric not null default 1;
alter table merchants add column if not exists bg_color text;
alter table merchants add column if not exists fg_color text;
alter table merchants add column if not exists label_color text;
alter table merchants add column if not exists assets_updated_at timestamptz;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'merchants_slug_key') then
    alter table merchants add constraint merchants_slug_key unique (slug);
  end if;
end $$;

create table if not exists staff (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid references merchants(id) on delete cascade,
  username text unique not null,
  password_hash text not null,                   -- bcrypt
  role text not null default 'cashier' check (role in ('owner','cashier')),
  created_at timestamptz default now()
);
alter table staff add column if not exists role text not null default 'cashier';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'staff_role_check') then
    alter table staff add constraint staff_role_check check (role in ('owner','cashier'));
  end if;
end $$;

create table if not exists passes (
  serial text primary key,                       -- uuid, also the QR payload
  merchant_id uuid references merchants(id) on delete set null,
  customer_name text,
  customer_phone text,
  points int not null default 0,                 -- cached balance (= sum of transactions)
  auth_token text not null,                      -- per-pass Wallet web-service token
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists passes_updated_idx on passes (updated_at);
-- one card per phone per merchant (enroll dedupe). Partial: passes without a
-- phone are not constrained.
create unique index if not exists passes_phone_uidx
  on passes (merchant_id, customer_phone)
  where customer_phone is not null;

-- a device = one iPhone that has added one or more passes
create table if not exists devices (
  device_lib_id text primary key,
  push_token text not null
);

-- which devices hold which passes (filled by Apple's register endpoint)
create table if not exists registrations (
  device_lib_id text references devices(device_lib_id) on delete cascade,
  serial text references passes(serial) on delete cascade,
  primary key (device_lib_id, serial)
);
create index if not exists registrations_serial_idx on registrations (serial);

-- the points ledger — every earn/redeem is an immutable row
create table if not exists transactions (
  id bigint generated always as identity primary key,
  serial text references passes(serial) on delete cascade,
  merchant_id uuid references merchants(id),      -- denormalised for tenant-scoped idempotency
  delta int not null,                             -- negative = redeem, positive = earn
  reason text,                                    -- e.g. "redeem:drinks", "earn:purchase"
  staff_id uuid references staff(id) on delete set null,
  idempotency_key text,                           -- client-supplied per-tap key (nullable)
  created_at timestamptz default now()
);
alter table transactions add column if not exists merchant_id uuid references merchants(id);
alter table transactions add column if not exists idempotency_key text;
alter table transactions add column if not exists amount numeric; -- raw bill $ on earns (Phase 2)
create index if not exists transactions_serial_idx on transactions (serial);
-- enforce idempotency only when a key is supplied; scope to (merchant, card) so
-- a key is idempotent for one specific card and one tenant can't probe another's.
drop index if exists transactions_idempo_uidx;
create unique index if not exists transactions_idempo_uidx
  on transactions (merchant_id, serial, idempotency_key)
  where idempotency_key is not null;

-- fixed-window rate limiter buckets (login/lookup/redeem). Works across
-- serverless instances because the counter lives in one shared Postgres.
create table if not exists rate_limits (
  bucket text primary key,                        -- e.g. 'login:1.2.3.4:alice' or 'redeem:<staff_id>'
  count int not null default 0,
  window_start timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- apply_points — the ONLY way a balance changes.
-- Atomic (single guarded UPDATE), tenant-safe (merchant_id predicate is the DB
-- backstop against IDOR), and idempotent (a replayed idempotency_key is a no-op
-- that returns the current balance). Returns a structured row so the caller
-- never has to parse exception message text.
--   status: 'applied' | 'replay' | 'insufficient' | 'not_found'
-- ---------------------------------------------------------------------------
-- p_amount param added later (Phase 2) — drop the old 6-arg signature first so
-- CREATE OR REPLACE doesn't leave an overload behind.
drop function if exists apply_points(text, int, text, uuid, uuid, text);
create or replace function apply_points(
  p_serial    text,
  p_delta     int,
  p_reason    text,
  p_staff     uuid,
  p_merchant  uuid,
  p_idempo    text default null,
  p_amount    numeric default null   -- raw bill amount on earns (null otherwise)
) returns table (status text, balance int)
language plpgsql
as $$
declare
  v_points int;
  v_txn_id bigint;
begin
  -- (1) Replay short-circuit: this key already produced a txn for this card → no-op.
  if p_idempo is not null then
    if exists (select 1 from transactions
                where merchant_id = p_merchant and serial = p_serial
                  and idempotency_key = p_idempo) then
      select pa.points into v_points
        from passes pa where pa.serial = p_serial and pa.merchant_id = p_merchant;
      return query select 'replay'::text, v_points;
      return;
    end if;
  end if;

  -- (2) Atomic, tenant-scoped, guarded balance update. Single statement.
  update passes
     set points = points + p_delta,
         updated_at = now()
   where serial = p_serial
     and merchant_id = p_merchant
     and points + p_delta >= 0
  returning points into v_points;

  -- (3) Disambiguate a non-update.
  if not found then
    -- Concurrent same-key retry: a parallel winner may have committed this key's
    -- txn (and decremented the balance) between our step (1) and now, making our
    -- guard fail. Re-check the key here so a genuine retry returns 'replay', not
    -- a misleading 'insufficient'.
    if p_idempo is not null and exists (
      select 1 from transactions
       where merchant_id = p_merchant and serial = p_serial
         and idempotency_key = p_idempo
    ) then
      select pa.points into v_points
        from passes pa where pa.serial = p_serial and pa.merchant_id = p_merchant;
      return query select 'replay'::text, v_points;
      return;
    end if;
    -- missing/wrong-tenant card vs. insufficient points
    if exists (select 1 from passes where serial = p_serial and merchant_id = p_merchant) then
      select pa.points into v_points
        from passes pa where pa.serial = p_serial and pa.merchant_id = p_merchant;
      return query select 'insufficient'::text, v_points;
    else
      return query select 'not_found'::text, null::int;
    end if;
    return;
  end if;

  -- (4) Ledger insert. ON CONFLICT closes the concurrent same-key race: the
  --     loser gets 0 rows back and must unwind its own balance bump (safe — it
  --     runs in the same implicit transaction as this call's +p_delta).
  insert into transactions (serial, merchant_id, delta, reason, staff_id, idempotency_key, amount)
       values (p_serial, p_merchant, p_delta, p_reason, p_staff, p_idempo, p_amount)
  on conflict (merchant_id, serial, idempotency_key) where idempotency_key is not null
  do nothing
  returning id into v_txn_id;

  if p_idempo is not null and v_txn_id is null then
    update passes set points = points - p_delta
      where serial = p_serial and merchant_id = p_merchant
      returning points into v_points;
    return query select 'replay'::text, v_points;
    return;
  end if;

  return query select 'applied'::text, v_points;
end;
$$;

-- ---------------------------------------------------------------------------
-- rate_limit_hit — atomic fixed-window counter. Returns true if the call is
-- ALLOWED, false if the bucket is over p_limit within the current window.
-- ---------------------------------------------------------------------------
create or replace function rate_limit_hit(
  p_bucket text, p_limit int, p_window_secs int
) returns boolean
language plpgsql
as $$
declare v_count int;
begin
  insert into rate_limits (bucket, count, window_start)
       values (p_bucket, 1, now())
  on conflict (bucket) do update
     set count = case
           when rate_limits.window_start < now() - make_interval(secs => p_window_secs)
           then 1 else rate_limits.count + 1 end,
         window_start = case
           when rate_limits.window_start < now() - make_interval(secs => p_window_secs)
           then now() else rate_limits.window_start end
  returning count into v_count;
  return v_count <= p_limit;
end;
$$;

-- Housekeeping: sweep stale rate-limit buckets (run via pg_cron, or occasionally).
--   delete from rate_limits where window_start < now() - interval '1 day';

-- ---------------------------------------------------------------------------
-- merchant_stats — owner dashboard metrics, all derived from the ledger so the
-- numbers reconcile by construction. Returns a single jsonb object.
-- ---------------------------------------------------------------------------
create or replace function merchant_stats(p_merchant uuid)
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'members',
      (select count(*) from passes where merchant_id = p_merchant),
    'active_members',
      (select count(distinct serial) from transactions
        where merchant_id = p_merchant
          and created_at > now() - interval '30 days'),
    'points_issued',
      (select coalesce(sum(delta), 0) from transactions
        where merchant_id = p_merchant and delta > 0),
    'points_redeemed',
      (select coalesce(-sum(delta), 0) from transactions
        where merchant_id = p_merchant and delta < 0),
    'top_redemptions',
      (select coalesce(jsonb_agg(row_to_json(r)), '[]'::jsonb) from (
        select reason, count(*)::int as count, (-sum(delta))::int as points
          from transactions
         where merchant_id = p_merchant and delta < 0 and reason like 'redeem:%'
         group by reason
         order by count(*) desc
         limit 10
      ) r),
    'repeat_rate',
      (select case when base.cnt = 0 then 0
                   else round(rep.cnt::numeric / base.cnt, 3) end
         from
           (select count(*) as cnt from (
              select serial from transactions
               where merchant_id = p_merchant and reason like 'earn:%'
               group by serial
            ) s) base,
           (select count(*) as cnt from (
              select serial from transactions
               where merchant_id = p_merchant and reason like 'earn:%'
               group by serial having count(*) >= 2
            ) s) rep)
  );
$$;

-- ===========================================================================
-- CRM / intelligence layer — Phase 1 (read-only analytics; no column changes)
-- All scoped by p_merchant; all return jsonb; all `stable`.
-- ===========================================================================

create index if not exists transactions_merchant_created_idx on transactions (merchant_id, created_at);
create index if not exists transactions_merchant_serial_reason_idx on transactions (merchant_id, serial, reason);

-- Customer list: search (name/phone), sort, paginate. Aggregates from the ledger.
create or replace function merchant_customers(
  p_merchant uuid,
  p_search   text default null,
  p_sort     text default 'recent',   -- 'recent' | 'points' | 'lifetime' | 'name'
  p_limit    int  default 50,
  p_offset   int  default 0
) returns jsonb language sql stable as $$
  with base as (
    select pa.serial, pa.customer_name, pa.customer_phone, pa.points, pa.created_at,
           coalesce(sum(t.delta) filter (where t.delta > 0), 0)::int  as lifetime_earned,
           coalesce(-sum(t.delta) filter (where t.delta < 0), 0)::int as lifetime_redeemed,
           count(t.id) filter (where t.reason like 'earn:%')::int      as visits,
           max(t.created_at)                                           as last_seen
      from passes pa
      left join transactions t on t.serial = pa.serial
     where pa.merchant_id = p_merchant
       and (p_search is null or p_search = ''
            or pa.customer_name ilike '%' || p_search || '%'
            or pa.customer_phone ilike '%' || p_search || '%')
     group by pa.serial, pa.customer_name, pa.customer_phone, pa.points, pa.created_at
  ), sorted as (
    select * from base
     order by
       case when p_sort = 'points'   then points end          desc nulls last,
       case when p_sort = 'lifetime' then lifetime_earned end  desc nulls last,
       case when p_sort = 'name'     then customer_name end    asc  nulls last,
       case when p_sort = 'recent'   then coalesce(last_seen, created_at) end desc nulls last,
       coalesce(last_seen, created_at) desc
  )
  select jsonb_build_object(
    'total', (select count(*) from base),
    'customers', coalesce((select jsonb_agg(row_to_json(x)) from (
        select * from sorted limit greatest(p_limit, 0) offset greatest(p_offset, 0)
      ) x), '[]'::jsonb)
  );
$$;

-- One customer's full profile (null if not this merchant's card).
create or replace function customer_profile(p_merchant uuid, p_serial text)
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'serial', pa.serial,
    'name', pa.customer_name,
    'phone', pa.customer_phone,
    'points', pa.points,
    'enrolled_at', pa.created_at,
    'lifetime_earned',   coalesce((select sum(delta)  from transactions where serial = pa.serial and delta > 0), 0)::int,
    'lifetime_redeemed', coalesce((select -sum(delta) from transactions where serial = pa.serial and delta < 0), 0)::int,
    'visits',     (select count(*) from transactions where serial = pa.serial and reason like 'earn:%')::int,
    'first_seen', (select min(created_at) from transactions where serial = pa.serial),
    'last_seen',  (select max(created_at) from transactions where serial = pa.serial),
    -- real bill total when amounts are stored, else inferred from points/earn_rate
    'estimated_spend', round(coalesce(
        (select sum(amount) from transactions where serial = pa.serial and reason = 'earn:purchase' and amount is not null),
        coalesce((select sum(delta) from transactions where serial = pa.serial and reason like 'earn:%'), 0)::numeric
          / nullif((select earn_rate from merchants where id = p_merchant), 0)
      ), 2),
    'spend_is_real', exists(select 1 from transactions where serial = pa.serial and reason = 'earn:purchase' and amount is not null),
    'favorite_redemption', (select reason from transactions
        where serial = pa.serial and reason like 'redeem:%'
        group by reason order by count(*) desc limit 1),
    'recent', coalesce((select jsonb_agg(row_to_json(r)) from (
        select delta, reason, created_at from transactions
         where serial = pa.serial order by created_at desc limit 20) r), '[]'::jsonb)
  )
  from passes pa
  where pa.serial = p_serial and pa.merchant_id = p_merchant;
$$;

-- Time series: new members + points issued/redeemed, bucketed (day|week|month).
create or replace function merchant_timeseries(
  p_merchant uuid, p_bucket text default 'day', p_from timestamptz default now() - interval '30 days'
) returns jsonb language sql stable as $$
  select jsonb_build_object(
    'bucket', p_bucket,
    'members', coalesce((select jsonb_agg(row_to_json(m) order by m.t) from (
        select date_trunc(p_bucket, created_at) as t, count(*)::int as n
          from passes where merchant_id = p_merchant and created_at >= p_from
         group by 1) m), '[]'::jsonb),
    'points', coalesce((select jsonb_agg(row_to_json(p) order by p.t) from (
        select date_trunc(p_bucket, created_at) as t,
               coalesce(sum(delta) filter (where delta > 0), 0)::int  as issued,
               coalesce(-sum(delta) filter (where delta < 0), 0)::int as redeemed
          from transactions where merchant_id = p_merchant and created_at >= p_from
         group by 1) p), '[]'::jsonb)
  );
$$;

-- Activity heatmap: day-of-week × hour transaction counts.
create or replace function activity_heatmap(
  p_merchant uuid, p_from timestamptz default now() - interval '90 days'
) returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(row_to_json(h)), '[]'::jsonb) from (
    select extract(dow from created_at)::int as dow,
           extract(hour from created_at)::int as hour,
           count(*)::int as n
      from transactions where merchant_id = p_merchant and created_at >= p_from
     group by 1, 2) h;
$$;

-- Per-staff activity (also the fraud signal in Phase 3).
create or replace function staff_activity(
  p_merchant uuid, p_from timestamptz default now() - interval '30 days'
) returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(row_to_json(s) order by s.txns desc), '[]'::jsonb) from (
    select st.username, st.role,
           count(t.id)::int as txns,
           coalesce(sum(t.delta) filter (where t.delta > 0), 0)::int  as points_issued,
           coalesce(-sum(t.delta) filter (where t.delta < 0), 0)::int as points_redeemed
      from staff st
      left join transactions t on t.staff_id = st.id and t.created_at >= p_from
     where st.merchant_id = p_merchant
     group by st.id, st.username, st.role) s;
$$;

-- RFM / behavioral segments: counts + per-customer label.
create or replace function merchant_segments(p_merchant uuid)
returns jsonb language sql stable as $$
  with agg as (
    select pa.serial, pa.customer_name,
           count(t.id) filter (where t.reason like 'earn:%')::int        as visits,
           max(t.created_at) filter (where t.reason like 'earn:%')        as last_earn,
           coalesce(sum(t.delta) filter (where t.delta > 0), 0)::int      as earned
      from passes pa
      left join transactions t on t.serial = pa.serial
     where pa.merchant_id = p_merchant
     group by pa.serial, pa.customer_name
  ), ranked as (
    select *,
           case when visits > 0 then extract(day from now() - last_earn)::int end as recency_days,
           case when earned > 0 then ntile(10) over (order by earned desc) end    as earn_decile
      from agg
  ), segmented as (
    select serial, customer_name, visits, recency_days, earned,
      case
        when visits = 0                                          then 'dormant'
        when recency_days > 90                                   then 'lapsed'
        when visits >= 3 and recency_days between 31 and 90      then 'at_risk'
        when earn_decile = 1 and recency_days <= 30              then 'vip'
        when visits >= 3 and recency_days <= 30                  then 'regular'
        when visits <= 1 and recency_days <= 30                  then 'new'
        else 'active'
      end as segment
      from ranked
  )
  select jsonb_build_object(
    'counts', (select coalesce(jsonb_object_agg(segment, n), '{}'::jsonb)
                 from (select segment, count(*)::int n from segmented group by segment) c),
    'customers', coalesce((select jsonb_agg(row_to_json(s)) from segmented s), '[]'::jsonb)
  );
$$;

-- ===========================================================================
-- CRM — Phase 2: contact + consent on customers; tags + notes.
-- ===========================================================================

alter table passes add column if not exists customer_email text;
alter table passes add column if not exists birthday date;
alter table passes add column if not exists marketing_consent boolean not null default false;
alter table passes add column if not exists consent_at timestamptz;
alter table passes add column if not exists consent_source text;

create table if not exists tags (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references merchants(id) on delete cascade,
  label text not null,
  color text,
  created_at timestamptz default now(),
  unique (merchant_id, label)
);

create table if not exists customer_tags (
  serial text references passes(serial) on delete cascade,
  tag_id uuid references tags(id) on delete cascade,
  merchant_id uuid not null references merchants(id) on delete cascade,
  created_at timestamptz default now(),
  primary key (serial, tag_id)
);
create index if not exists customer_tags_merchant_idx on customer_tags (merchant_id, serial);

create table if not exists customer_notes (
  id bigint generated always as identity primary key,
  serial text references passes(serial) on delete cascade,
  merchant_id uuid not null references merchants(id) on delete cascade,
  staff_id uuid references staff(id) on delete set null,
  body text not null,
  created_at timestamptz default now()
);
create index if not exists customer_notes_serial_idx on customer_notes (serial, created_at desc);
