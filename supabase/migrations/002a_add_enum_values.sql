-- STEP 1 of 2: run this alone first, then run 002b.
-- (Postgres cannot use a new enum value in the same transaction that adds it.)
-- Safe to run even if you already ran an earlier version of this file.
alter type public.transaction_type add value if not exists 'repayment';
alter type public.transaction_type add value if not exists 'payback';
