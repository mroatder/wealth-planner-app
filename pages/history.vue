<script setup>
// "ประวัติ": look back, search, edit and delete. Recording new things lives in /transactions.
const supabase = useSupabaseClient();

// Two views of the same data:
//   ของเรา  = expenses split with the partner (either way) + the repayments between us
//   ส่วนตัว = everything else (personal spending, income, transfers, goal savings)
const SCOPES = [
  { value: 'shared', label: 'ของเรา' },
  { value: 'personal', label: 'ส่วนตัว' },
];
const TYPE_FILTERS = {
  personal: [
    { value: 'all', label: 'ทั้งหมด' },
    { value: 'expense', label: 'รายจ่าย' },
    { value: 'income', label: 'รายรับ' },
    { value: 'other', label: 'อื่นๆ' }, // transfers, goal savings
  ],
  shared: [
    { value: 'all', label: 'ทั้งหมด' },
    { value: 'expense', label: 'รายจ่ายที่หาร' },
    { value: 'settle', label: 'ชำระคืน' },
  ],
};
const isSettle = (t) => t.type === 'repayment' || t.type === 'payback';
const isShared = (t) => t.type === 'expense' && t.is_shared;
const inScope = (t, s) => ((isShared(t) || isSettle(t)) === (s === 'shared'));
const TYPE_LABEL = { income: 'รายรับ', expense: 'รายจ่าย', transfer: 'โอน', goal_deposit: 'ออมเข้าเป้าหมาย', goal_withdraw: 'ถอนจากเป้าหมาย', repayment: 'รับเงินคืน', payback: 'จ่ายคืน' };
const toNumber = (s) => Number(String(s ?? '').replace(/,/g, ''));

// ---------- month navigation ----------
const pad = (n) => String(n).padStart(2, '0');
const now = new Date();
const cursor = ref(new Date(now.getFullYear(), now.getMonth(), 1));
const keyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
const monthKey = computed(() => keyOf(cursor.value));
const monthLabel = computed(() => cursor.value.toLocaleDateString('th-TH', { month: 'long', year: 'numeric' }));
const shift = (n) => { cursor.value = new Date(cursor.value.getFullYear(), cursor.value.getMonth() + n, 1); openId.value = null; };
const bkk = (iso) => new Date(new Date(iso).getTime() + 7 * 3600e3); // Thailand wall clock

// ---------- data ----------
const { data, refresh, pending, error: loadErr, loaded } = useLoad('history', async () => {
  const next = new Date(cursor.value.getFullYear(), cursor.value.getMonth() + 1, 1);
  const from = new Date(`${monthKey.value}-01T00:00:00+07:00`).toISOString();
  const to = new Date(`${keyOf(next)}-01T00:00:00+07:00`).toISOString();

  // the month's transactions (possibly several pages) load at the same time as wallets, categories and the balance
  const loadRows = async () => {
    const out = [];
    for (let page = 0; ; page++) {
      const { data: part, error } = await supabase.from('transactions')
        .select('id,type,amount,owed_amount,is_fixed,is_shared,is_settled,settles_id,paid_by_partner,occurred_at,note,wallet_id,to_wallet_id,category_id,slip_drive_file_id')
        .gte('occurred_at', from).lt('occurred_at', to)
        .order('occurred_at', { ascending: false }).order('id')
        .range(page * 1000, page * 1000 + 999);
      if (error) throw error;
      out.push(...part);
      if (part.length < 1000) break;
    }
    return out;
  };
  const [rows, wallets, cats, profile, balance] = await Promise.all([
    loadRows(),
    supabase.from('wallets').select('id,name').order('name'),
    supabase.from('categories').select('id,name,type').order('name'),
    supabase.from('users').select('partner_name').maybeSingle(),
    supabase.from('partner_balance').select('owed_to_me').maybeSingle(),
  ]);
  for (const r of [wallets, cats]) if (r.error) throw r.error;
  return {
    rows, wallets: wallets.data, categories: cats.data,
    partner: profile.data?.partner_name || 'แฟน',
    owed: Number(balance.data?.owed_to_me ?? 0), // all-time: + partner owes me, - I owe partner
  };
}, { watch: [monthKey], default: () => ({ rows: [], wallets: [], categories: [], partner: 'แฟน', owed: 0 }) });

const partner = computed(() => data.value.partner);
const walletName = (id) => data.value.wallets.find((w) => w.id === id)?.name ?? '—';
const categoryName = (id) => data.value.categories.find((c) => c.id === id)?.name;

// ---------- filters ----------
const scope = ref('shared');
const typeFilter = ref('all');
const walletFilter = ref('');
const query = ref('');

// remember which view was open last
onMounted(() => {
  try {
    const v = localStorage.getItem('history-scope');
    if (v === 'shared' || v === 'personal') scope.value = v;
  } catch { /* storage unavailable */ }
});
watch(scope, (v) => {
  typeFilter.value = 'all';
  openId.value = null;
  try { localStorage.setItem('history-scope', v); } catch { /* storage unavailable */ }
});

const scopeCount = (s) => data.value.rows.filter((t) => inScope(t, s)).length;

const matchesType = (t) => {
  const f = typeFilter.value;
  if (f === 'all') return true;
  if (scope.value === 'shared') return f === 'settle' ? isSettle(t) : isShared(t);
  return f === 'other' ? !['expense', 'income'].includes(t.type) : t.type === f;
};

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase();
  return data.value.rows.filter((t) => inScope(t, scope.value) && matchesType(t)
    && (!walletFilter.value || t.wallet_id === walletFilter.value || t.to_wallet_id === walletFilter.value)
    && (!q || (t.note ?? '').toLowerCase().includes(q) || (categoryName(t.category_id) ?? '').toLowerCase().includes(q)));
});

const myShare = (t) => Number(t.amount) - Number(t.owed_amount);
const totals = computed(() => {
  let income = 0;
  let expense = 0;
  let settled = 0; // money moved between us this month
  for (const t of filtered.value) {
    if (t.type === 'income') income += Number(t.amount);
    else if (t.type === 'expense') expense += myShare(t);
    else if (isSettle(t)) settled += Number(t.amount);
  }
  return { income, expense, settled };
});
const net = computed(() => data.value.owed); // all-time: + partner owes me, - I owe partner

// group by day (Thailand time), newest first
const days = computed(() => {
  const map = new Map();
  for (const t of filtered.value) {
    const key = bkk(t.occurred_at).toISOString().slice(0, 10);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(t);
  }
  return [...map.entries()].map(([key, items]) => ({
    key,
    label: new Date(`${key}T12:00:00`).toLocaleDateString('th-TH', { weekday: 'short', day: 'numeric', month: 'short' }),
    expense: items.filter((t) => t.type === 'expense').reduce((s, t) => s + myShare(t), 0),
    items,
  }));
});

const amountClass = (t) => (['income', 'repayment'].includes(t.type) ? 'text-income' : ['expense', 'payback'].includes(t.type) ? 'text-expense' : 'text-muted');
const amountSign = (t) => (['income', 'repayment'].includes(t.type) ? '+' : ['expense', 'payback'].includes(t.type) ? '−' : '');

// ---------- open a row: details + actions ----------
const openId = ref(null);
watch(monthKey, () => { openId.value = null; });
const mode = ref('view'); // view | edit | delete
const edit = reactive({ note: '', amount: '', categoryId: '', occurredAt: '', isFixed: false });
const actionError = ref('');
const busy = ref(false);

// Slips live in a private bucket: ask for a short-lived signed link when a row is opened
const slipView = reactive({ id: null, url: '', error: '' });
const hasStoredSlip = (t) => (t.slip_drive_file_id ?? '').startsWith('slips/');
async function loadSlip(t) {
  Object.assign(slipView, { id: t.id, url: '', error: '' });
  if (!hasStoredSlip(t)) return;
  const { data, error } = await supabase.storage.from('slips').createSignedUrl(t.slip_drive_file_id.slice('slips/'.length), 900);
  if (slipView.id !== t.id) return; // another row was opened meanwhile
  if (error) slipView.error = /not found|row-level/i.test(error.message) ? 'เปิดสลิปไม่ได้: ยังไม่ได้รัน migration 005_slips_storage.sql' : `เปิดสลิปไม่ได้: ${error.message}`;
  else slipView.url = data.signedUrl;
}

function open(t) {
  if (openId.value === t.id) return (openId.value = null);
  openId.value = t.id;
  mode.value = 'view';
  actionError.value = '';
  loadSlip(t);
}
const current = computed(() => data.value.rows.find((t) => t.id === openId.value));

function startEdit(t) {
  Object.assign(edit, {
    note: t.note ?? '', amount: String(t.amount), categoryId: t.category_id ?? '',
    occurredAt: toLocalInput(new Date(t.occurred_at)), isFixed: t.is_fixed,
  });
  actionError.value = '';
  mode.value = 'edit';
}

const editCategories = computed(() => data.value.categories.filter((c) => c.type === current.value?.type));

async function saveEdit() {
  const t = current.value;
  actionError.value = '';
  const amount = toNumber(edit.amount);
  if (!(amount > 0)) return (actionError.value = 'กรุณากรอกจำนวนเงิน');
  if (amount < Number(t.owed_amount)) return (actionError.value = `ยอดต้องไม่น้อยกว่ายอดที่${partner.value}ต้องคืน (${formatMoney(t.owed_amount)})`);
  const hasCategory = ['expense', 'income'].includes(t.type);
  if (hasCategory && !edit.categoryId) return (actionError.value = 'กรุณาเลือกหมวดหมู่');
  busy.value = true;
  const patch = {
    amount,
    note: edit.note.trim() || null,
    occurred_at: new Date(edit.occurredAt).toISOString(),
  };
  if (hasCategory) patch.category_id = edit.categoryId;
  if (t.type === 'expense') patch.is_fixed = edit.isFixed;
  const { error } = await supabase.from('transactions').update(patch).eq('id', t.id);
  busy.value = false;
  if (error) return (actionError.value = error.message);
  mode.value = 'view';
  await refresh();
}

// Helper to format database RPC function error messages cleanly
const rpcHint = (e) => {
  const text = `${e?.message ?? ''} ${e?.code ?? ''}`;
  if (/could not find the function|PGRST202/i.test(text)) {
    return /settle_expense/.test(text)
      ? 'ยังไม่ได้รัน migration 006_settle_items.sql ใน Supabase'
      : 'ยังไม่ได้รัน migration 004_delete_functions.sql (และ 006) ใน Supabase';
  }
  return e?.message ?? String(e);
};

async function remove() {
  actionError.value = '';
  busy.value = true;
  try {
    // Deleted through a database function (POST): some networks block the HTTP DELETE verb.
    const { data: gone, error } = await supabase.rpc('delete_transaction', { p_id: openId.value });
    if (error) throw error;
    if (!gone) throw new Error('ลบไม่สำเร็จ: ฐานข้อมูลไม่ได้ลบรายการนี้ (อาจไม่มีสิทธิ์ หรือรายการถูกลบไปแล้ว) ลองรีเฟรชหน้า');
    openId.value = null;
    await refresh();
  } catch (e) {
    actionError.value = rpcHint(e);
    console.error('delete failed', e);
  } finally {
    busy.value = false;
  }
}

// Move an expense between "ส่วนตัว" and "ของเรา". Moving to ours splits it 50/50 (partner owes half).
async function moveScope(t) {
  actionError.value = '';
  busy.value = true;
  const toShared = !t.is_shared;
  const { error } = await supabase.from('transactions').update({
    is_shared: toShared,
    owed_amount: toShared ? Math.round((Number(t.amount) / 2) * 100) / 100 : 0,
  }).eq('id', t.id);
  busy.value = false;
  if (error) return (actionError.value = error.message);
  openId.value = null;
  await refresh();
}

// PAID means the money really moved: ticking records a repayment (partner -> me) or a payback (me -> partner)
// in the default wallet; un-ticking removes it. It is the same thing as "บันทึกรับคืน" on the ยอดค้าง page.
// Old rows "paid" by the previous toggle (owed amount zeroed, nothing recorded) still count as PAID.
const isPaid = (t) => t.is_settled || (t.type === 'expense' && t.is_shared && !t.paid_by_partner && Number(t.owed_amount) === 0);
const toggleError = ref('');

async function togglePaidStatus(t) {
  toggleError.value = '';
  busy.value = true;
  try {
    if (isPaid(t)) {
      const { error } = await supabase.rpc('unsettle_expense', { p_id: t.id });
      if (error) throw error;
    } else {
      const wallet = defaultWallet(data.value.wallets);
      if (!wallet) throw new Error('ต้องมีกระเป๋าก่อนถึงจะบันทึกการรับ/จ่ายคืนได้');
      const { error } = await supabase.rpc('settle_expense', { p_id: t.id, p_wallet: wallet.id });
      if (error) throw error;
    }
    await refresh();
  } catch (e) {
    toggleError.value = rpcHint(e);
    console.error('toggle paid failed', e);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="mx-auto max-w-3xl">
    <div class="flex items-end justify-between gap-4">
      <h1 class="title">ประวัติ</h1>
      <NuxtLink to="/transactions" class="btn btn-primary">+ บันทึกรายการ</NuxtLink>
    </div>

    <p v-if="loadErr" class="mt-4 rounded-lg bg-expense/10 px-4 py-3 text-sm text-expense">
      โหลดข้อมูลไม่สำเร็จ: {{ loadErr.message }}
      <span class="block text-xs text-muted">ถ้าเพิ่งอัปเดตฐานข้อมูล ให้ตรวจว่ารัน migration 002a และ 002b ใน Supabase แล้ว</span>
    </p>

    <!-- Month -->
    <MonthPicker v-model="cursor" class="mt-5" />

    <!-- Two views: ours (shared with the partner) / personal -->
    <div class="mt-4 segmented grid-cols-2" role="tablist" aria-label="มุมมองประวัติ">
      <button v-for="sc in SCOPES" :key="sc.value" role="tab" :aria-selected="scope === sc.value" :aria-pressed="scope === sc.value" @click="scope = sc.value">
        {{ sc.label }} <span class="num font-normal text-muted">{{ scopeCount(sc.value) }}</span>
      </button>
    </div>

    <!-- Where we stand with the partner (all time) -->
    <NuxtLink v-if="scope === 'shared'" to="/partner" class="card mt-3 flex items-center justify-between gap-3 px-4 py-3 text-sm">
      <span class="text-muted">
        <template v-if="!loaded">กำลังโหลด…</template>
        <template v-else-if="net === 0">ไม่มียอดค้างกับ {{ partner }} ตอนนี้</template>
        <template v-else-if="net > 0">{{ partner }} ต้องจ่ายคืนเรา</template>
        <template v-else>เราต้องจ่ายคืน {{ partner }}</template>
      </span>
      <span class="flex items-center gap-2">
        <span v-if="net !== 0" class="num font-semibold" :class="net < 0 ? 'text-expense' : 'text-income'">{{ formatMoney(Math.abs(net)) }}</span>
        <span class="text-accent">ดูยอดค้าง ›</span>
      </span>
    </NuxtLink>

    <!-- Filters -->
    <div class="mt-3 space-y-3">
      <div class="segmented" :class="scope === 'personal' ? 'grid-cols-4' : 'grid-cols-3'">
        <button v-for="f in TYPE_FILTERS[scope]" :key="f.value" :aria-pressed="typeFilter === f.value" @click="typeFilter = f.value">{{ f.label }}</button>
      </div>
      <div class="grid gap-3 sm:grid-cols-2">
        <input v-model="query" type="search" class="field" placeholder="ค้นหา เช่น กาแฟ, Food Cost" aria-label="ค้นหา" />
        <select v-model="walletFilter" class="field" aria-label="กรองตามกระเป๋า">
          <option value="">ทุกกระเป๋า</option>
          <option v-for="w in data.wallets" :key="w.id" :value="w.id">{{ w.name }}</option>
        </select>
      </div>
    </div>

    <!-- Totals for what is shown -->
    <div class="num mt-4 flex flex-wrap gap-x-5 gap-y-1 px-1 text-sm text-muted">
      <span>{{ filtered.length }} รายการ</span>
      <template v-if="scope === 'personal'">
        <span>รายรับ <span class="font-medium text-ink">{{ formatMoney(totals.income) }}</span></span>
        <span>รายจ่าย <span class="font-medium text-ink">{{ formatMoney(totals.expense) }}</span></span>
      </template>
      <template v-else>
        <span>ส่วนของเรา <span class="font-medium text-ink">{{ formatMoney(totals.expense) }}</span></span>
        <span v-if="totals.settled">ชำระคืนกัน <span class="font-medium text-ink">{{ formatMoney(totals.settled) }}</span></span>
      </template>
    </div>

    <p v-if="toggleError" class="mt-3 break-words rounded-lg bg-expense/10 px-4 py-3 text-sm text-expense">{{ toggleError }}</p>

    <p v-if="!days.length" class="card mt-4 px-4 py-6 text-center text-sm text-muted">
      {{ pending ? 'กำลังโหลด…' : scopeCount(scope) ? 'ไม่พบรายการที่ตรงกับตัวกรอง' : scope === 'shared' ? 'ยังไม่มีรายการที่หารกันในเดือนนี้' : 'ยังไม่มีรายการส่วนตัวในเดือนนี้' }}
    </p>

    <!-- Days -->
    <section v-for="day in days" :key="day.key" class="mt-5">
      <div class="mb-1.5 flex items-baseline justify-between px-1">
        <h2 class="section-label !px-0">{{ day.label }}</h2>
        <span v-if="day.expense > 0" class="num text-xs text-muted">จ่าย {{ formatMoney(day.expense) }}</span>
      </div>

      <ul class="card divide-y divide-line overflow-hidden">
        <li v-for="t in day.items" :key="t.id">
          <div class="flex cursor-pointer items-center justify-between gap-4 px-4 py-3 transition hover:bg-ink/[0.03]" @click="open(t)">
            <div class="min-w-0">
              <div class="truncate text-[15px]">
                {{ t.type === 'transfer' ? `${walletName(t.wallet_id)} → ${walletName(t.to_wallet_id)}` : (t.note || categoryName(t.category_id) || TYPE_LABEL[t.type]) }}
              </div>
              <div class="truncate text-xs text-muted">
                <template v-if="t.note && categoryName(t.category_id)">{{ categoryName(t.category_id) }} · </template>{{ toLocalInput(new Date(t.occurred_at)).slice(11) }}<template v-if="t.type !== 'transfer' && !t.paid_by_partner"> · {{ walletName(t.wallet_id) }}</template><template v-if="t.is_fixed"> · ประจำ</template>
              </div>
              <div v-if="t.paid_by_partner" class="text-xs text-muted">{{ partner }} จ่ายไปก่อน · นับเฉพาะส่วนเรา</div>
              <div v-if="isShared(t)" class="mt-1.5 flex items-center gap-2">
                <button
                  type="button"
                  class="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold transition disabled:opacity-50"
                  :class="isPaid(t) ? 'bg-emerald-500/15 text-emerald-600 hover:bg-emerald-500/25' : 'bg-amber-500/15 text-amber-600 hover:bg-amber-500/25'"
                  :disabled="busy"
                  :title="isPaid(t) ? 'แตะเพื่อยกเลิกการรับ/จ่ายคืน' : 'แตะเพื่อบันทึกว่ารับ/จ่ายคืนแล้ว (ใช้กระเป๋าไทยพาณิชย์เป็นหลัก)'"
                  @click.stop="togglePaidStatus(t)"
                >
                  <span>{{ isPaid(t) ? '✓ PAID' : '⏳ PENDING' }}</span>
                </button>
                <span v-if="t.paid_by_partner" class="num text-xs text-muted">เรา{{ isPaid(t) ? 'จ่ายคืนแล้ว' : 'ต้องคืน' }} {{ formatMoney(t.amount) }}</span>
                <span v-else-if="Number(t.owed_amount || 0) > 0" class="num text-xs text-muted">{{ partner }} {{ isPaid(t) ? 'จ่ายคืนแล้ว' : 'คืน' }} {{ formatMoney(t.owed_amount) }}</span>
              </div>
            </div>
            <div class="num shrink-0 text-[15px] font-medium" :class="amountClass(t)">{{ amountSign(t) }}{{ formatMoney(t.amount) }}</div>
          </div>

          <!-- Actions -->
          <div v-if="openId === t.id" class="space-y-3 bg-ink/[0.03] px-4 py-3">
            <template v-if="mode === 'view'">
              <div class="text-xs text-muted">
                {{ formatDate(t.occurred_at) }} {{ toLocalInput(new Date(t.occurred_at)).slice(11) }}
                <template v-if="t.type === 'expense' && Number(t.owed_amount) > 0"> · ส่วนของเรา {{ formatMoney(myShare(t)) }}</template>
              </div>
              <div v-if="hasStoredSlip(t)" class="mt-2 rounded border border-line bg-surface p-2">
                <div v-if="slipView.id === t.id && slipView.url" class="flex items-center gap-2">
                  <img :src="slipView.url" alt="สลิป" class="h-12 w-10 shrink-0 rounded border border-line object-cover" />
                  <a :href="slipView.url" target="_blank" rel="noopener" class="text-xs font-medium text-accent hover:underline">📎 เปิดดูรูปสลิป ↗</a>
                </div>
                <p v-else-if="slipView.error && slipView.id === t.id" class="text-xs text-expense">{{ slipView.error }}</p>
                <p v-else class="text-xs text-muted">กำลังโหลดสลิป…</p>
              </div>
              <p v-if="actionError" class="text-sm text-expense">{{ actionError }}</p>
              <div class="flex flex-wrap gap-x-5 gap-y-2 text-sm">
                <button class="text-accent" @click="startEdit(t)">แก้ไข</button>
                <button v-if="t.type === 'expense' && !t.is_shared" class="text-accent" :disabled="busy" @click="moveScope(t)">ย้ายไปของเรา (หาร 2)</button>
                <button v-else-if="t.type === 'expense' && !t.paid_by_partner && !t.is_settled" class="text-accent" :disabled="busy" @click="moveScope(t)">ย้ายไปส่วนตัว</button>
                <button class="text-expense" @click="actionError = ''; mode = 'delete'">ลบ</button>
              </div>
            </template>

            <div v-else-if="mode === 'delete'" class="space-y-2 text-sm">
              <div class="flex items-center justify-between gap-3">
                <span class="text-muted">{{ t.is_settled ? 'ลบรายการนี้? รายการรับ/จ่ายคืนที่ผูกอยู่จะถูกลบด้วย ยอดกระเป๋าและยอดค้างจะคำนวณใหม่' : t.settles_id ? 'ลบรายการนี้? รายการที่หารกันซึ่งผูกอยู่จะกลับเป็น PENDING' : 'ลบรายการนี้? ยอดกระเป๋าและยอดค้างจะคำนวณใหม่' }}</span>
                <span class="flex shrink-0 gap-4">
                  <button class="text-muted" @click="mode = 'view'">ยกเลิก</button>
                  <button class="font-medium text-expense" :disabled="busy" @click="remove">{{ busy ? 'กำลังลบ…' : 'ยืนยันลบ' }}</button>
                </span>
              </div>
              <p v-if="actionError" class="break-words text-expense">{{ actionError }}</p>
            </div>

            <form v-else class="space-y-4" @submit.prevent="saveEdit">
              <div class="grid gap-3 sm:grid-cols-2">
                <div>
                  <label class="label" :for="`e-amt-${t.id}`">{{ t.paid_by_partner ? 'ส่วนของเรา (บาท)' : 'จำนวนเงิน (บาท)' }}</label>
                  <input :id="`e-amt-${t.id}`" v-model="edit.amount" inputmode="decimal" class="field num" />
                </div>
                <div>
                  <label class="label" :for="`e-when-${t.id}`">วันที่และเวลา (24 ชม.)</label>
                  <DateTimePicker24h :id="`e-when-${t.id}`" v-model="edit.occurredAt" />
                </div>
              </div>
              <div>
                <label class="label" :for="`e-note-${t.id}`">{{ t.type === 'expense' ? 'ค่าอะไร' : 'บันทึกเพิ่มเติม' }}</label>
                <input :id="`e-note-${t.id}`" v-model="edit.note" class="field" maxlength="200" />
              </div>
              <div v-if="['expense', 'income'].includes(t.type)">
                <label class="label" :for="`e-cat-${t.id}`">หมวดหมู่</label>
                <select :id="`e-cat-${t.id}`" v-model="edit.categoryId" class="field">
                  <option v-for="c in editCategories" :key="c.id" :value="c.id">{{ c.name }}</option>
                </select>
              </div>
              <ToggleRow v-if="t.type === 'expense'" v-model="edit.isFixed" label="เป็นรายจ่ายประจำ (Fix cost)" />
              <p v-if="isShared(t)" class="text-xs text-muted">
                หากต้องการเปลี่ยนวิธีหารหรือคนจ่าย ให้ลบแล้วบันทึกใหม่
              </p>
              <p v-if="actionError" class="text-sm text-expense">{{ actionError }}</p>
              <div class="flex gap-2">
                <button class="btn btn-primary" :disabled="busy">บันทึก</button>
                <button type="button" class="btn btn-quiet" @click="mode = 'view'">ยกเลิก</button>
              </div>
            </form>
          </div>
        </li>
      </ul>
    </section>
  </div>
</template>
