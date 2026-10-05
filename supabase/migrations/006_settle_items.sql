-- Ticking a shared expense as PAID now records the REAL repayment between you and your partner:
--   * you paid, partner owes you  -> a "repayment" (money comes INTO a wallet, the partner's debt shrinks)
--   * partner paid, you owe them  -> a "payback"   (money goes OUT of a wallet, your debt shrinks)
-- Un-ticking (PENDING again) removes that repayment/payback. Your own share of the expense never changes.
-- Done in database functions so each change is atomic and goes over POST (see 004 about blocked DELETE/PATCH).
-- Safe to re-run.

alter table public.transactions add column if not exists is_settled boolean not null default false;
alter table public.transactions add column if not exists settles_id uuid references public.transactions(id) on delete cascade;

-- A column called is_settled may ALREADY exist: an earlier experiment (003_add_is_settled.sql) added it with
-- DEFAULT TRUE, so every old row - incomes and transfers too - looked "settled". Nothing else uses it, so reset
-- it to the meaning used here: true only for an expense whose repayment / payback has been recorded.
-- (Re-running keeps the rows that really do have a linked repayment.)
alter table public.transactions alter column is_settled set default false;
update public.transactions t
set is_settled = false
where t.is_settled
  and not exists (select 1 from public.transactions r where r.settles_id = t.id);

alter table public.transactions drop constraint if exists settled_only_expense;
alter table public.transactions add constraint settled_only_expense check (not is_settled or type = 'expense');
alter table public.transactions drop constraint if exists settles_only_settlements;
alter table public.transactions add constraint settles_only_settlements check (settles_id is null or type in ('repayment', 'payback'));
create unique index if not exists transactions_settles_id_key on public.transactions (settles_id) where settles_id is not null;

-- Tick as PAID. Returns the id of the repayment / payback that was recorded.
create or replace function public.settle_expense(p_id uuid, p_wallet uuid) returns uuid
language plpgsql security invoker set search_path = public as $$
declare
  e public.transactions;
  who text;
  new_id uuid;
begin
  select * into e from public.transactions where id = p_id and type = 'expense' and is_shared for update;
  if not found then raise exception 'ไม่พบรายการที่หารกัน'; end if;
  if e.is_settled then raise exception 'รายการนี้บันทึกการชำระไปแล้ว'; end if;
  select coalesce(partner_name, 'แฟน') into who from public.users where id = e.user_id;

  if e.paid_by_partner then
    insert into public.transactions (user_id, wallet_id, type, amount, occurred_at, note, settles_id)
    values (e.user_id, p_wallet, 'payback', e.amount, now(), 'จ่ายคืน ' || who || ': ' || coalesce(e.note, ''), e.id)
    returning id into new_id;
  else
    if e.owed_amount <= 0 then raise exception 'รายการนี้ไม่มียอดค้างให้บันทึก'; end if;
    insert into public.transactions (user_id, wallet_id, type, amount, occurred_at, note, settles_id)
    values (e.user_id, p_wallet, 'repayment', e.owed_amount, now(), who || ' จ่ายคืน: ' || coalesce(e.note, ''), e.id)
    returning id into new_id;
  end if;

  update public.transactions set is_settled = true where id = e.id;
  return new_id;
end $$;

-- Back to PENDING: removes the linked repayment / payback.
-- Old rows that were "paid" by the previous toggle (owed amount zeroed, no repayment recorded) are re-opened as a 50/50 split.
create or replace function public.unsettle_expense(p_id uuid) returns boolean
language plpgsql security invoker set search_path = public as $$
declare e public.transactions;
begin
  select * into e from public.transactions where id = p_id and type = 'expense' and is_shared for update;
  if not found then return false; end if;

  delete from public.transactions where settles_id = p_id;

  if e.is_settled then
    update public.transactions set is_settled = false where id = p_id;
  elsif not e.paid_by_partner and e.owed_amount = 0 then
    update public.transactions set owed_amount = round(e.amount / 2, 2) where id = p_id;
  end if;
  return true;
end $$;

-- Deleting a repayment / payback by hand puts its expense back to PENDING
-- (deleting the expense itself removes its repayment automatically: on delete cascade).
create or replace function public.delete_transaction(p_id uuid) returns boolean
language plpgsql security invoker set search_path = public as $$
declare
  n integer;
  linked uuid;
begin
  select settles_id into linked from public.transactions where id = p_id;
  delete from public.transactions where id = p_id;
  get diagnostics n = row_count;
  if n > 0 and linked is not null then
    update public.transactions set is_settled = false where id = linked;
  end if;
  return n > 0;
end $$;

revoke all on function public.settle_expense(uuid, uuid) from public, anon;
revoke all on function public.unsettle_expense(uuid)     from public, anon;
revoke all on function public.delete_transaction(uuid)   from public, anon;
grant execute on function public.settle_expense(uuid, uuid) to authenticated;
grant execute on function public.unsettle_expense(uuid)     to authenticated;
grant execute on function public.delete_transaction(uuid)   to authenticated;
