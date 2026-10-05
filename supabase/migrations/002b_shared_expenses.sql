-- STEP 2 of 2: split expenses with a partner + your category list. Keeps all existing data.
-- Safe to re-run.

alter table public.users        add column if not exists partner_name text not null default 'แฟน';
alter table public.transactions add column if not exists owed_amount  numeric(14,2) not null default 0;
alter table public.transactions add column if not exists is_fixed     boolean not null default false;
alter table public.transactions add column if not exists paid_by_partner boolean not null default false;

alter table public.transactions drop constraint if exists transaction_shape;
alter table public.transactions add  constraint transaction_shape check (
     (type in ('income','expense','repayment','payback') and to_wallet_id is null and goal_id is null)
  or (type = 'transfer' and to_wallet_id is not null and goal_id is null and to_wallet_id <> wallet_id)
  or (type in ('goal_deposit','goal_withdraw') and goal_id is not null and to_wallet_id is null)
);
alter table public.transactions drop constraint if exists owed_rules;
alter table public.transactions add  constraint owed_rules check (
  owed_amount >= 0 and owed_amount <= amount and (type = 'expense' or owed_amount = 0)
);
alter table public.transactions drop constraint if exists partner_paid_rules;
alter table public.transactions add  constraint partner_paid_rules check (
  not paid_by_partner or (type = 'expense' and owed_amount = 0)
);

create or replace view public.wallet_balances with (security_invoker = true) as
select w.id as wallet_id, w.user_id, w.name, w.type,
  w.initial_balance
  + coalesce((select sum(case
                           when t.paid_by_partner then 0
                           when t.type in ('income','goal_withdraw','repayment') then t.amount
                           else -t.amount end)
              from public.transactions t where t.wallet_id = w.id), 0)
  + coalesce((select sum(t.amount) from public.transactions t where t.to_wallet_id = w.id), 0) as balance
from public.wallets w
where not w.is_archived;

create or replace view public.budget_progress with (security_invoker = true) as
select b.id, b.user_id, b.category_id, c.name as category_name, b.month, b.amount_limit,
  coalesce(sum(t.amount - t.owed_amount), 0) as spent,
  round(coalesce(sum(t.amount - t.owed_amount), 0) / b.amount_limit * 100, 1) as percent_used
from public.budgets b
join public.categories c on c.id = b.category_id
left join public.transactions t on t.category_id = b.category_id and t.user_id = b.user_id
  and t.type = 'expense'
  and date_trunc('month', t.occurred_at at time zone 'Asia/Bangkok')::date = b.month
group by b.id, c.name;

-- Positive: partner owes me.  Negative: I owe my partner.
create or replace view public.partner_balance with (security_invoker = true) as
select u.id as user_id,
  coalesce((select sum(case
                         when t.type = 'expense' and not t.paid_by_partner then  t.owed_amount
                         when t.type = 'expense' and     t.paid_by_partner then -t.amount
                         when t.type = 'repayment' then -t.amount
                         when t.type = 'payback'   then  t.amount
                         else 0 end)
            from public.transactions t where t.user_id = u.id), 0) as owed_to_me
from public.users u;

-- ---- Your category list (existing users) ----
insert into public.categories (user_id, name, type)
select u.id, c.name, c.type::category_type
from public.users u
cross join (values
  ('Mortgage','expense'),('Electricity Bill','expense'),('Water Bill','expense'),('Gas','expense'),
  ('Internet','expense'),('Food Cost','expense'),('Household Items','expense'),('Netflix','expense'),
  ('House Decoretions','expense'),('Beverage','expense'),('Debt Payments','expense'),('Skin Care','expense'),
  ('Streaming','expense'),('Other','expense'),
  ('Salary','income'),('Side Income','income'),('Other','income')
) as c(name, type)
on conflict (user_id, name, type) do nothing;

-- Remove the old Thai default EXPENSE categories only if nothing uses them
delete from public.categories c
where c.type = 'expense'
  and c.name in ('อาหาร','เดินทาง','ที่พัก/ค่าน้ำไฟ','ช้อปปิ้ง','บันเทิง','สุขภาพ','อื่นๆ')
  and not exists (select 1 from public.transactions t where t.category_id = c.id)
  and not exists (select 1 from public.budgets b where b.category_id = c.id);

-- Names: you are Oat, your partner is Rin
update public.users set display_name = 'Oat', partner_name = 'Rin' where partner_name = 'แฟน';
