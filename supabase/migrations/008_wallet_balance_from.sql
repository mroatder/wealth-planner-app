-- Each wallet can say "count my balance from this moment": the initial balance is what the wallet held at that moment,
-- and only transactions at or after it move the balance. Anything earlier stays in history/analytics only.
alter table public.wallets add column if not exists balance_from timestamptz;

create or replace view public.wallet_balances with (security_invoker = true) as
select w.id as wallet_id, w.user_id, w.name, w.type,
  w.initial_balance
  + coalesce((select sum(case
                           when t.paid_by_partner then 0
                           when t.type in ('income','goal_withdraw','repayment') then t.amount
                           else -t.amount end)
              from public.transactions t
              where t.wallet_id = w.id and not t.is_historical
                and (w.balance_from is null or t.occurred_at >= w.balance_from)), 0)
  + coalesce((select sum(t.amount) from public.transactions t
              where t.to_wallet_id = w.id and not t.is_historical
                and (w.balance_from is null or t.occurred_at >= w.balance_from)), 0) as balance
from public.wallets w
where not w.is_archived;

-- Your setup (edit the names if yours differ):
-- ไทยพาณิชย์: starts at 0 from the moment the 28 Sep income arrived
update public.wallets w
set initial_balance = 0,
    balance_from = (select min(t.occurred_at) from public.transactions t
                    where t.wallet_id = w.id and t.type = 'income'
                      and t.occurred_at >= timestamptz '2026-09-28 00:00:00+07'
                      and t.occurred_at <  timestamptz '2026-09-29 00:00:00+07')
where w.name ilike '%ไทยพาณิชย์%' or w.name ilike '%scb%';

-- กรุงไทย: 618 baht on 29 Sep
update public.wallets
set initial_balance = 618, balance_from = timestamptz '2026-09-29 00:00:00+07'
where name ilike '%กรุงไทย%' or name ilike '%ktb%';
