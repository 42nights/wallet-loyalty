-- Manual verification for apply_points() + the idempotency race.
-- Run AFTER schema.sql, in the Supabase SQL editor (or psql). Self-contained:
-- it seeds a throwaway merchant/pass, asserts each branch, then cleans up.
-- Every "expect" comment states what the row before it must show.

begin;

-- throwaway fixtures
insert into merchants (id, name, slug, earn_rate)
  values ('00000000-0000-0000-0000-0000000000aa', 'TEST CO', 'test-co', 1)
  on conflict (id) do nothing;
insert into staff (id, merchant_id, username, password_hash, role)
  values ('00000000-0000-0000-0000-0000000000bb',
          '00000000-0000-0000-0000-0000000000aa', 'test-owner', 'x', 'owner')
  on conflict (id) do nothing;
insert into passes (serial, merchant_id, points, auth_token)
  values ('TEST-SERIAL', '00000000-0000-0000-0000-0000000000aa', 100, 'tok')
  on conflict (serial) do update set points = 100;

-- 1. applied: +50 → balance 150
select * from apply_points('TEST-SERIAL', 50, 'earn:test',
  '00000000-0000-0000-0000-0000000000bb', '00000000-0000-0000-0000-0000000000aa', null);
-- expect: status=applied, balance=150

-- 2. insufficient: -1000 from 150 → rejected, balance unchanged 150
select * from apply_points('TEST-SERIAL', -1000, 'redeem:test',
  '00000000-0000-0000-0000-0000000000bb', '00000000-0000-0000-0000-0000000000aa', null);
-- expect: status=insufficient, balance=150

-- 3. not_found: wrong merchant for this serial
select * from apply_points('TEST-SERIAL', 10, 'earn:test',
  '00000000-0000-0000-0000-0000000000bb', '00000000-0000-0000-0000-0000000000ff', null);
-- expect: status=not_found, balance=NULL

-- 4. idempotent first apply with a key: -50 → balance 100
select * from apply_points('TEST-SERIAL', -50, 'redeem:test',
  '00000000-0000-0000-0000-0000000000bb', '00000000-0000-0000-0000-0000000000aa', 'KEY-1');
-- expect: status=applied, balance=100

-- 5. idempotent REPLAY: same key again → no-op, balance still 100
select * from apply_points('TEST-SERIAL', -50, 'redeem:test',
  '00000000-0000-0000-0000-0000000000bb', '00000000-0000-0000-0000-0000000000aa', 'KEY-1');
-- expect: status=replay, balance=100

-- 6. ledger integrity: exactly one row for KEY-1; cached balance == sum(delta)
select count(*) as key1_rows from transactions where idempotency_key = 'KEY-1';
-- expect: 1
select (select points from passes where serial = 'TEST-SERIAL') as cached,
       (select coalesce(sum(delta),0) from transactions where serial = 'TEST-SERIAL') as ledger_sum;
-- expect: cached == ledger_sum (both 100)

rollback;  -- discard all fixtures + test writes

-- ---------------------------------------------------------------------------
-- CONCURRENT same-key race (cannot be done in one session). In TWO psql
-- sessions, run these interleaved against a committed test pass:
--   session A: BEGIN; select * from apply_points('S', -10,'r',<staff>,<merch>,'RACE');
--   session B: BEGIN; select * from apply_points('S', -10,'r',<staff>,<merch>,'RACE');
--   commit A, then commit B.
-- Expect: exactly one returns 'applied', the other 'replay'; the pass balance
-- drops by 10 ONCE; exactly one transactions row has idempotency_key='RACE'.
-- ---------------------------------------------------------------------------
