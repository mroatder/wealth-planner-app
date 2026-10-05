-- wealth-planner-app : Supabase / PostgreSQL schema (v2)
-- Run in Supabase Dashboard > SQL Editor. Safe to re-run: it DROPS and recreates everything (deletes app data!).
-- Requires PostgreSQL 15+ (default for new Supabase projects).

-- ========== RESET ==========
drop trigger if exists on_auth_user_created on auth.users;
drop view if exists public.budget_progress, public.net_worth, public.goal_progress, public.partner_balance, public.wallet_balances;
drop table if exists public.transactions, public.budgets, public.goals, public.categories, public.wallets, public.users cascade;
drop function if exists public.handle_new_user(), public.validate_transaction();
drop type if exists wallet_type, category_type, transaction_type, goal_status;

create extension if not exists "pgcrypto";

-- ========== ENUMS ==========
create type wallet_type      as enum ('cash','bank','credit_card','investment','other');
create type category_type    as enum ('income','expense');
create type goal_status      as enum ('active','completed','cancelled');
-- income / expense : money enters / leaves wallet_id
-- transfer         : wallet_id -> to_wallet_id
-- goal_deposit     : wallet_id -> goal_id
-- goal_withdraw    : goal_id   -> wallet_id  (e.g. refund when a goal is cancelled)
-- repayment        : partner pays me back their share of a split expense, into wallet_id (not real income)
-- payback          : I pay my partner back what I owe, out of wallet_id
create type transaction_type as enum ('income','expense','transfer','goal_deposit','goal_withdraw','repayment','payback');

-- ========== USERS (profile, linked to Supabase Auth) ==========
create table public.users (
  id           uuid primary key references auth.users(id) on delete cascade,
  email        text,
  display_name text,
  currency     char(3) not null default 'THB',
  partner_name text not null default 'แฟน',   -- label for split expenses
  created_at   timestamptz not null default now()
);

-- ========== WALLETS ==========
create table public.wallets (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.users(id) on delete cascade,
  name            text not null,
  type            wallet_type not null default 'cash',
  initial_balance numeric(14,2) not null default 0,   -- credit card: negative = existing debt
  is_archived     boolean not null default false,
  created_at      timestamptz not null default now(),
  unique (user_id, name),
  unique (id, user_id)                                 -- target for ownership-checking composite FKs
);
create index on public.wallets (user_id);

-- ========== CATEGORIES ==========
create table public.categories (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.users(id) on delete cascade,
  name       text not null,
  type       category_type not null,
  icon       text,
  color      text,
  created_at timestamptz not null default now(),
  unique (user_id, name, type),
  unique (id, user_id)
);
create index on public.categories (user_id);

-- ========== GOALS ==========
-- Saved amount is NOT stored here; it is derived from transactions (see goal_progress view).
create table public.goals (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.users(id) on delete cascade,
  name           text not null,
  target_amount  numeric(14,2) not null check (target_amount > 0),
  deadline       date,
  status         goal_status not null default 'active',
  created_at     timestamptz not null default now(),
  unique (id, user_id)
);
create index on public.goals (user_id);

-- ========== TRANSACTIONS ==========
-- Composite FKs (x_id, user_id) guarantee a transaction can only reference the owner's own rows.
create table public.transactions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.users(id) on delete cascade,
  wallet_id     uuid not null,
  to_wallet_id  uuid,
  goal_id       uuid,
  category_id   uuid,
  type          transaction_type not null,
  amount        numeric(14,2) not null check (amount > 0),
  owed_amount   numeric(14,2) not null default 0,  -- part of an expense the partner must pay back
  is_fixed      boolean not null default false,    -- fixed/recurring expense flag
  paid_by_partner boolean not null default false,  -- partner paid up front; amount = MY share, wallet is untouched
  is_shared     boolean not null default false,    -- split with the partner (stays true even after it is settled)
  is_historical boolean not null default false,    -- imported history: kept for reports, never moves a wallet balance
  occurred_at   timestamptz not null default now(),
  note          text,
  slip_drive_file_id text,      -- Google Drive file id
  slip_url           text,      -- webViewLink
  ocr_raw_text       text,
  created_at    timestamptz not null default now(),

  foreign key (wallet_id,    user_id) references public.wallets(id,    user_id) on delete no action,
  foreign key (to_wallet_id, user_id) references public.wallets(id,    user_id) on delete no action,
  foreign key (goal_id,      user_id) references public.goals(id,      user_id) on delete no action,
  foreign key (category_id,  user_id) references public.categories(id, user_id) on delete set null (category_id),

  constraint transaction_shape check (
       (type in ('income','expense','repayment','payback') and to_wallet_id is null and goal_id is null)
    or (type = 'transfer'                       and to_wallet_id is not null and goal_id is null and to_wallet_id <> wallet_id)
    or (type in ('goal_deposit','goal_withdraw') and goal_id is not null and to_wallet_id is null)
  ),
  constraint owed_rules check (owed_amount >= 0 and owed_amount <= amount and (type = 'expense' or owed_amount = 0)),
  constraint partner_paid_rules check (not paid_by_partner or (type = 'expense' and owed_amount = 0)),
  constraint shared_only_expense check (not is_shared or type = 'expense')
);
create index on public.transactions (user_id, occurred_at desc);
create index on public.transactions (wallet_id);
create index on public.transactions (to_wallet_id);
create index on public.transactions (category_id);
create index on public.transactions (goal_id);

-- Business rules that CHECK constraints cannot express
create or replace function public.validate_transaction() returns trigger
language plpgsql as $$
declare
  cat_type text;
  saved numeric;
begin
  -- category only on income/expense, and its type must match
  if new.category_id is not null then
    if new.type not in ('income','expense') then
      raise exception 'category is only allowed on income/expense transactions';
    end if;
    select type::text into cat_type from public.categories where id = new.category_id;
    if cat_type is distinct from new.type::text then
      raise exception 'category type (%) does not match transaction type (%)', cat_type, new.type;
    end if;
  end if;

  -- cannot withdraw more from a goal than it holds
  if new.type = 'goal_withdraw' then
    select coalesce(sum(case type when 'goal_deposit' then amount when 'goal_withdraw' then -amount end), 0)
      into saved
      from public.transactions
      where goal_id = new.goal_id and id is distinct from new.id;
    if new.amount > saved then
      raise exception 'withdraw (%) exceeds goal balance (%)', new.amount, saved;
    end if;
  end if;
  return new;
end $$;
create trigger trg_validate_transaction before insert or update on public.transactions
  for each row execute function public.validate_transaction();

-- ========== BUDGETS ==========
create table public.budgets (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.users(id) on delete cascade,
  category_id  uuid not null,
  amount_limit numeric(14,2) not null check (amount_limit > 0),
  month        date not null check (month = date_trunc('month', month)::date), -- first day of month
  created_at   timestamptz not null default now(),
  unique (user_id, category_id, month),
  foreign key (category_id, user_id) references public.categories(id, user_id) on delete cascade
);

-- ========== VIEWS (all derived, so numbers can never drift out of sync) ==========
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

create or replace view public.goal_progress with (security_invoker = true) as
select g.id as goal_id, g.user_id, g.name, g.target_amount, g.deadline, g.status,
  s.saved,
  least(round(s.saved / g.target_amount * 100, 1), 100) as percent
from public.goals g
cross join lateral (
  select coalesce(sum(case t.type when 'goal_deposit' then t.amount when 'goal_withdraw' then -t.amount end), 0) as saved
  from public.transactions t where t.goal_id = g.id
) s;

-- Net worth = wallet balances + money held in goals (a cancelled goal keeps counting until withdrawn)
create or replace view public.net_worth with (security_invoker = true) as
select u.id as user_id,
  coalesce((select sum(balance) from public.wallet_balances b where b.user_id = u.id), 0)
  + coalesce((select sum(saved)  from public.goal_progress  p where p.user_id = u.id), 0) as net_worth
from public.users u;

create or replace view public.budget_progress with (security_invoker = true) as
select b.id, b.user_id, b.category_id, c.name as category_name, b.month, b.amount_limit,
  coalesce(sum(t.amount - t.owed_amount), 0) as spent,   -- my own share only
  round(coalesce(sum(t.amount - t.owed_amount), 0) / b.amount_limit * 100, 1) as percent_used
from public.budgets b
join public.categories c on c.id = b.category_id
left join public.transactions t on t.category_id = b.category_id and t.user_id = b.user_id
  and t.type = 'expense'
  and date_trunc('month', t.occurred_at at time zone 'Asia/Bangkok')::date = b.month
group by b.id, c.name;

-- Positive: partner owes me.  Negative: I owe my partner.
--   + their share of expenses I paid        - repayments they made to me
--   - my share of expenses they paid        + paybacks I made to them
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

-- ========== ROW LEVEL SECURITY ==========
alter table public.users        enable row level security;
alter table public.wallets      enable row level security;
alter table public.categories   enable row level security;
alter table public.transactions enable row level security;
alter table public.budgets      enable row level security;
alter table public.goals        enable row level security;

create policy "own profile"      on public.users        for all using (id = auth.uid())      with check (id = auth.uid());
create policy "own wallets"      on public.wallets      for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own categories"   on public.categories   for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own transactions" on public.transactions for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own budgets"      on public.budgets      for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own goals"        on public.goals        for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ========== SIGN-UP HOOK: profile + default categories ==========
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.users (id, email, display_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email,'@',1)));

  insert into public.categories (user_id, name, type) values
    (new.id,'Mortgage','expense'),(new.id,'Electricity Bill','expense'),(new.id,'Water Bill','expense'),
    (new.id,'Gas','expense'),(new.id,'Internet','expense'),(new.id,'Food Cost','expense'),
    (new.id,'Household Items','expense'),(new.id,'Netflix','expense'),(new.id,'House Decoretions','expense'),
    (new.id,'Beverage','expense'),(new.id,'Debt Payments','expense'),(new.id,'Skin Care','expense'),
    (new.id,'Streaming','expense'),(new.id,'Other','expense'),
    (new.id,'Salary','income'),(new.id,'Side Income','income'),(new.id,'Other','income');
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();
