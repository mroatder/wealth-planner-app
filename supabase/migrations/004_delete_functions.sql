-- Delete through POST (rpc) instead of the HTTP DELETE verb, which some firewalls / proxies block
-- (symptom: "DELETE ... 403 Access Denied ... Failed to fetch" in the browser console).
--
-- SECURITY INVOKER: the functions run as the signed-in user, so row level security still applies
-- and a user can only ever delete their own rows. Safe to re-run.

create or replace function public.delete_transaction(p_id uuid) returns boolean
language plpgsql security invoker set search_path = public as $$
declare n integer;
begin
  delete from public.transactions where id = p_id;
  get diagnostics n = row_count;
  return n > 0;
end $$;

create or replace function public.delete_budget(p_id uuid) returns boolean
language plpgsql security invoker set search_path = public as $$
declare n integer;
begin
  delete from public.budgets where id = p_id;
  get diagnostics n = row_count;
  return n > 0;
end $$;

-- Used by "ลบรายการทั้งหมด" on the import page. Returns how many rows were removed.
create or replace function public.delete_all_my_transactions() returns integer
language plpgsql security invoker set search_path = public as $$
declare n integer;
begin
  delete from public.transactions where user_id = auth.uid();
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.delete_transaction(uuid)       from public, anon;
revoke all on function public.delete_budget(uuid)            from public, anon;
revoke all on function public.delete_all_my_transactions()   from public, anon;
grant execute on function public.delete_transaction(uuid)     to authenticated;
grant execute on function public.delete_budget(uuid)          to authenticated;
grant execute on function public.delete_all_my_transactions() to authenticated;
