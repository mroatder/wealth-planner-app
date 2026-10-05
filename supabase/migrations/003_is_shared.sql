-- Remember that an expense was SHARED with the partner, independent of how much is still owed.
-- (Without this, setting owed_amount to 0 would make a shared expense look personal.)
-- Safe to re-run.

alter table public.transactions add column if not exists is_shared boolean not null default false;

-- Backfill: everything already split, or paid by the partner, is shared
update public.transactions
set is_shared = true
where type = 'expense' and (owed_amount > 0 or paid_by_partner);

alter table public.transactions drop constraint if exists shared_only_expense;
alter table public.transactions add constraint shared_only_expense check (not is_shared or type = 'expense');
