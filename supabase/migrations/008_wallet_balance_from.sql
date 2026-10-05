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

-- Fresh start at an exact moment: 6 Oct 2026 (2569) 00:16 Bangkok time. Every wallet is 0 from then; any transaction dated
-- before that minute moves no balance (it stays in history/analytics). Then type each wallet's real bank balance as of
-- that moment as its initial balance (wallets page).
update public.wallets set initial_balance = 0, balance_from = timestamptz '2026-10-06 00:16:00+07';
