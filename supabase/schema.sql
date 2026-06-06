-- 42nights loyalty — schema
-- Run in the Supabase SQL editor (or psql).

create extension if not exists "pgcrypto";

create table if not exists merchants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  pass_type_id text,            -- optional per-merchant override; default from env
  logo_url text,
  created_at timestamptz default now()
);

create table if not exists staff (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid references merchants(id) on delete cascade,
  username text unique not null,
  password_hash text not null,  -- bcrypt
  created_at timestamptz default now()
);

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
  delta int not null,             -- negative = redeem, positive = earn
  reason text,                    -- e.g. "redeem:drinks", "earn:visit"
  staff_id uuid references staff(id) on delete set null,
  created_at timestamptz default now()
);
create index if not exists transactions_serial_idx on transactions (serial);
