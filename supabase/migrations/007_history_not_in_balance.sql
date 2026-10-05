-- Imported / historical rows are kept for history and analytics but do NOT move wallet balances.
alter table public.transactions add column if not exists is_historical boolean not null default false;

create or replace view public.wallet_balances with (security_invoker = true) as
select w.id as wallet_id, w.user_id, w.name, w.type,
  w.initial_balance
  + coalesce((select sum(case
                           when t.paid_by_partner then 0
                           when t.type in ('income','goal_withdraw','repayment') then t.amount
                           else -t.amount end)
              from public.transactions t where t.wallet_id = w.id and not t.is_historical), 0)
  + coalesce((select sum(t.amount) from public.transactions t where t.to_wallet_id = w.id and not t.is_historical), 0) as balance
from public.wallets w
where not w.is_archived;

-- One-off: everything dated before the cut-off is history (no effect on wallet balances). The cut-off is the start of the
-- pay cycle you track from (here 28 Sep 2026, Bangkok time), so the income received that day still counts.
-- Set each wallet's initial balance to the bank balance you had just BEFORE that moment.
update public.transactions
set is_historical = (occurred_at < timestamptz '2026-09-28 00:00:00+07');
