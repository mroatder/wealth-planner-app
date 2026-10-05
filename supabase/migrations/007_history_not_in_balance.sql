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

-- One-off: everything dated before the 1st of this month (Bangkok time) is treated as history.
-- Rows from this month onwards keep counting. Adjust or skip this statement if that is not what you want.
update public.transactions
set is_historical = true
where occurred_at < date_trunc('month', now() at time zone 'Asia/Bangkok') at time zone 'Asia/Bangkok';
