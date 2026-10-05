-- Is the database ready for real use?  Paste into the Supabase SQL Editor and Run (read-only, changes nothing).
-- Every line should say ✅. A line that says ❌ names what is missing; the hint after "→" says which file fixes it.

with checks(name, ok, fix) as (
  select 'row level security is ON for all 6 tables',
    (select count(*) = 6 from pg_tables where schemaname = 'public' and rowsecurity
       and tablename in ('users', 'wallets', 'categories', 'transactions', 'budgets', 'goals')),
    'schema.sql'
  union all select 'sign-up trigger (creates profile + default categories)',
    exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid where c.relname = 'users' and t.tgname = 'on_auth_user_created'),
    'schema.sql'
  union all select 'views: wallet_balances, net_worth, budget_progress, goal_progress, partner_balance',
    (select count(*) = 5 from pg_views where schemaname = 'public'
       and viewname in ('wallet_balances', 'net_worth', 'budget_progress', 'goal_progress', 'partner_balance')),
    'schema.sql (+ migrations/002b)'
  union all select 'transaction types repayment + payback',
    (select count(*) = 2 from pg_enum e join pg_type t on t.oid = e.enumtypid
       where t.typname = 'transaction_type' and e.enumlabel in ('repayment', 'payback')),
    'migrations/002a then 002b'
  union all select 'columns owed_amount, is_fixed, paid_by_partner on transactions',
    (select count(*) = 3 from information_schema.columns where table_schema = 'public' and table_name = 'transactions'
       and column_name in ('owed_amount', 'is_fixed', 'paid_by_partner')),
    'migrations/002b'
  union all select 'column is_shared on transactions',
    exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'transactions' and column_name = 'is_shared'),
    'migrations/003_is_shared'
  union all select 'columns is_settled (default false) + settles_id on transactions',
    (select count(*) = 2 from information_schema.columns where table_schema = 'public' and table_name = 'transactions'
       and ((column_name = 'is_settled' and column_default = 'false') or column_name = 'settles_id')),
    'migrations/006_settle_items'
  union all select 'delete functions (delete_transaction, delete_budget, delete_all_my_transactions)',
    (select count(*) = 3 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname in ('delete_transaction', 'delete_budget', 'delete_all_my_transactions')),
    'migrations/004_delete_functions'
  union all select 'settle functions (settle_expense, unsettle_expense)',
    (select count(*) = 2 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname in ('settle_expense', 'unsettle_expense')),
    'migrations/006_settle_items'
  union all select 'storage bucket "slips" exists and is PRIVATE',
    exists (select 1 from storage.buckets where id = 'slips' and not public),
    'migrations/005_slips_storage'
  union all select 'slip policies: read + upload only inside your own folder',
    (select count(*) = 2 from pg_policies where schemaname = 'storage' and tablename = 'objects'
       and policyname in ('slips: read own folder', 'slips: upload to own folder')),
    'migrations/005_slips_storage'
  union all select 'NO loose slip policies left over from 005_slips_bucket.sql',
    not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
       and policyname in ('Allow Slips Insert', 'Authenticated Slips Update', 'Authenticated Slips Delete',
                          'Authenticated Slips Insert', 'Public Slips Select', 'Public Slips Insert', 'Public Slips Update')),
    'migrations/005_slips_storage (it removes them)'
)
select case when ok then '✅' else '❌' end as status, name, case when ok then '' else '→ run ' || fix end as how_to_fix
from checks
order by ok, name;
