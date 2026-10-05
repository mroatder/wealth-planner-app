<script setup>
const supabase = useSupabaseClient();
const user = useSupabaseUser();
const uid = computed(() => user.value?.id ?? user.value?.sub);

const toNumber = (s) => Number(String(s ?? '').replace(/,/g, ''));
const round2 = (n) => Math.round(n * 100) / 100;

// ---------- data ----------
// Every row that creates or settles a balance between us:
//   expense I paid and split (partner owes me)  | expense partner paid (I owe)  | repayment (partner paid me)  | payback (I paid partner)
const { data, refresh, error: loadErr, loaded } = useLoad('partner-page', async () => {
  const rows = [];
  for (let page = 0; ; page++) {
    const { data: part, error } = await supabase.from('transactions')
      .select('id,type,amount,owed_amount,paid_by_partner,is_settled,settles_id,occurred_at,note,category_id')
      .or('and(type.eq.expense,owed_amount.gt.0),and(type.eq.expense,paid_by_partner.eq.true),type.eq.repayment,type.eq.payback')
      .order('occurred_at').order('id')
      .range(page * 1000, page * 1000 + 999);
    if (error) throw error;
    rows.push(...part);
    if (part.length < 1000) break;
  }
  const [profile, cats, wallets] = await Promise.all([
    supabase.from('users').select('display_name,partner_name').maybeSingle(),
    supabase.from('categories').select('id,name'),
    supabase.from('wallet_balances').select('wallet_id,name,balance').order('name'),
  ]);
  for (const r of [profile, cats, wallets]) if (r.error) throw r.error;
  return {
    rows,
    me: profile.data?.display_name || 'เรา',
    partner: profile.data?.partner_name || 'แฟน',
    categories: Object.fromEntries(cats.data.map((c) => [c.id, c.name])),
    wallets: wallets.data,
  };
}, { default: () => ({ rows: [], me: 'เรา', partner: 'แฟน', categories: {}, wallets: [] }) });

const me = computed(() => data.value.me);
const partner = computed(() => data.value.partner);

// delta > 0: partner owes me more.  delta < 0: I owe partner more.
function describe(r) {
  const cat = data.value.categories[r.category_id];
  if (r.type === 'repayment') return { delta: -Number(r.amount), kind: `${partner.value} จ่ายคืนเรา`, title: r.note || 'รับเงินคืน' };
  if (r.type === 'payback') return { delta: Number(r.amount), kind: `เราจ่ายคืน ${partner.value}`, title: r.note || 'จ่ายคืน' };
  if (r.paid_by_partner) return { delta: -Number(r.amount), kind: `${partner.value} จ่ายให้ก่อน`, title: r.note || cat || 'รายจ่าย' };
  return { delta: Number(r.owed_amount), kind: `เราจ่าย แล้วหารกัน`, title: r.note || cat || 'รายจ่าย' };
}

const ledger = computed(() => {
  let balance = 0;
  return data.value.rows.map((r) => {
    const d = describe(r);
    balance = round2(balance + d.delta);
    return { ...r, ...d, balance, category: data.value.categories[r.category_id] };
  });
});
const net = computed(() => ledger.value.at(-1)?.balance ?? 0); // + partner owes me, - I owe partner

const stats = computed(() => {
  const s = { owedToMe: 0, received: 0, iOwe: 0, paidBack: 0 };
  for (const r of data.value.rows) {
    if (r.type === 'repayment') s.received += Number(r.amount);
    else if (r.type === 'payback') s.paidBack += Number(r.amount);
    else if (r.paid_by_partner) s.iOwe += Number(r.amount);
    else s.owedToMe += Number(r.owed_amount);
  }
  return s;
});

const showAll = ref(false);
const history = computed(() => [...ledger.value].reverse());
const visible = computed(() => (showAll.value ? history.value : history.value.slice(0, 30)));

// ---------- settle up ----------
const settle = reactive({ amount: '', walletId: '', note: '' });
const settleTouched = ref(false);
const settleError = ref('');
const busy = ref(false);

watch(net, (n) => { if (!settleTouched.value) settle.amount = n === 0 ? '' : String(Math.abs(n)); }, { immediate: true });
watch(() => data.value.wallets, (w) => { if (!settle.walletId && w.length) settle.walletId = defaultWallet(w).wallet_id; }, { immediate: true });

async function submitSettle() {
  settleError.value = '';
  const amount = toNumber(settle.amount);
  if (!(amount > 0)) return (settleError.value = 'กรุณากรอกจำนวนเงิน');
  if (!settle.walletId) return (settleError.value = 'กรุณาเลือกกระเป๋า');
  busy.value = true;
  const { error } = await supabase.from('transactions').insert({
    user_id: uid.value,
    type: net.value > 0 ? 'repayment' : 'payback',
    amount,
    wallet_id: settle.walletId,
    occurred_at: new Date().toISOString(),
    note: settle.note.trim() || (net.value > 0 ? `${partner.value} จ่ายคืน` : `จ่ายคืน ${partner.value}`),
  });
  busy.value = false;
  if (error) return (settleError.value = error.message);
  Object.assign(settle, { note: '' });
  settleTouched.value = false;
  await refresh();
}

// ---------- tick an item as PAID (same action as the PAID button in the history page) ----------
const itemError = ref('');
const rpcHint = (e) => (/could not find the function|PGRST202/i.test(`${e?.message} ${e?.code}`)
  ? 'ยังไม่ได้รัน migration 006_settle_items.sql ใน Supabase' : (e?.message ?? String(e)));

async function toggleItem(t) {
  itemError.value = '';
  busy.value = true;
  try {
    if (t.is_settled) {
      const { error } = await supabase.rpc('unsettle_expense', { p_id: t.id });
      if (error) throw error;
    } else {
      if (!settle.walletId) throw new Error('ต้องมีกระเป๋าก่อนถึงจะบันทึกการรับ/จ่ายคืนได้');
      const { error } = await supabase.rpc('settle_expense', { p_id: t.id, p_wallet: settle.walletId });
      if (error) throw error;
    }
    await refresh();
  } catch (e) {
    itemError.value = rpcHint(e);
    console.error('toggle item failed', e);
  } finally {
    busy.value = false;
  }
}

// ---------- names ----------
const editingNames = ref(false);
const names = reactive({ me: '', partner: '' });
const nameError = ref('');
function startNames() {
  Object.assign(names, { me: me.value === 'เรา' ? '' : me.value, partner: partner.value === 'แฟน' ? '' : partner.value });
  nameError.value = '';
  editingNames.value = true;
}
async function saveNames() {
  nameError.value = '';
  if (!names.partner.trim()) return (nameError.value = 'กรุณาใส่ชื่อ');
  busy.value = true;
  const { error } = await supabase.from('users')
    .update({ display_name: names.me.trim() || null, partner_name: names.partner.trim() })
    .eq('id', uid.value);
  busy.value = false;
  if (error) return (nameError.value = error.message);
  editingNames.value = false;
  await refresh();
}
</script>

<template>
  <div class="mx-auto max-w-3xl">
    <div class="flex items-end justify-between gap-4">
      <h1 class="title">ยอดค้างกับ {{ partner }}</h1>
      <button class="text-sm text-accent" @click="editingNames ? (editingNames = false) : startNames()">{{ editingNames ? 'ปิด' : 'เปลี่ยนชื่อ' }}</button>
    </div>

    <p v-if="loadErr" class="mt-4 rounded-lg bg-expense/10 px-4 py-3 text-sm text-expense">
      โหลดข้อมูลไม่สำเร็จ: {{ loadErr.message }}
      <span class="block text-xs text-muted">ถ้าเพิ่งอัปเดตฐานข้อมูล ให้ตรวจว่ารัน migration 002a และ 002b ใน Supabase แล้ว</span>
    </p>

    <form v-if="editingNames" class="card mt-4 space-y-4 p-5" @submit.prevent="saveNames">
      <div class="grid gap-4 sm:grid-cols-2">
        <div>
          <label class="label" for="n-me">ชื่อเรา</label>
          <input id="n-me" v-model="names.me" class="field" placeholder="เช่น Oat" />
        </div>
        <div>
          <label class="label" for="n-partner">ชื่อแฟน</label>
          <input id="n-partner" v-model="names.partner" class="field" placeholder="เช่น Rin" />
        </div>
      </div>
      <p v-if="nameError" class="text-sm text-expense">{{ nameError }}</p>
      <button class="btn btn-primary" :disabled="busy">บันทึกชื่อ</button>
    </form>

    <!-- Net balance -->
    <section class="card mt-6 px-5 py-5">
      <template v-if="!loaded">
        <div class="h-20 animate-pulse rounded-lg bg-ink/10"></div>
      </template>
      <template v-else-if="net === 0">
        <div class="text-[13px] font-medium text-muted">สถานะ</div>
        <div class="mt-1 text-[28px] font-bold leading-tight tracking-tight">ไม่มียอดค้างกัน</div>
        <div class="mt-1 text-sm text-muted">{{ ledger.length ? 'เคลียร์กันครบแล้ว' : `ยังไม่มีรายการหารกับ ${partner}` }}</div>
      </template>
      <template v-else>
        <div class="text-[13px] font-medium text-muted">{{ net > 0 ? `${partner} ต้องจ่ายคืนเรา` : `เราต้องจ่ายคืน ${partner}` }}</div>
        <div class="num mt-1 text-[40px] font-bold leading-tight tracking-tight" :class="net < 0 ? 'text-expense' : 'text-income'">
          {{ formatMoney(Math.abs(net)) }} <span class="text-base font-medium text-muted">บาท</span>
        </div>
      </template>
    </section>

    <!-- Both directions -->
    <section class="mt-3 grid gap-3 sm:grid-cols-2">
      <div class="card px-5 py-4">
        <div class="text-[13px] font-medium text-muted">{{ partner }} ติดเรา</div>
        <div class="num mt-1 text-[20px] font-bold tracking-tight">{{ formatMoney(Math.max(stats.owedToMe - stats.received, 0)) }}</div>
        <div class="num mt-1 text-xs text-muted">หารทั้งหมด {{ formatMoney(stats.owedToMe) }} · จ่ายคืนแล้ว {{ formatMoney(stats.received) }}</div>
      </div>
      <div class="card px-5 py-4">
        <div class="text-[13px] font-medium text-muted">เราติด {{ partner }}</div>
        <div class="num mt-1 text-[20px] font-bold tracking-tight">{{ formatMoney(Math.max(stats.iOwe - stats.paidBack, 0)) }}</div>
        <div class="num mt-1 text-xs text-muted">{{ partner }} จ่ายให้ {{ formatMoney(stats.iOwe) }} · จ่ายคืนแล้ว {{ formatMoney(stats.paidBack) }}</div>
      </div>
    </section>
    <p class="mt-2 px-1 text-xs text-muted">ยอดสองฝั่งหักล้างกันเป็นยอดสุทธิด้านบน</p>

    <!-- Settle up -->
    <form v-if="net !== 0" class="card mt-6 space-y-4 p-5" @submit.prevent="submitSettle">
      <h2 class="text-[15px] font-semibold">{{ net > 0 ? `บันทึกที่ ${partner} จ่ายคืน` : `บันทึกที่เราจ่ายคืน ${partner}` }}</h2>
      <div class="grid gap-4 sm:grid-cols-2">
        <div>
          <label class="label" for="s-amount">จำนวนเงิน (บาท)</label>
          <input id="s-amount" v-model="settle.amount" inputmode="decimal" class="field num" @input="settleTouched = true" />
        </div>
        <div>
          <label class="label" for="s-wallet">{{ net > 0 ? 'รับเข้ากระเป๋า' : 'จ่ายจากกระเป๋า' }}</label>
          <select id="s-wallet" v-model="settle.walletId" class="field">
            <option v-for="w in data.wallets" :key="w.wallet_id" :value="w.wallet_id">{{ w.name }} · {{ formatMoney(w.balance) }}</option>
          </select>
        </div>
      </div>
      <div>
        <label class="label" for="s-note">โน้ต <span class="text-faint">(ไม่บังคับ)</span></label>
        <input id="s-note" v-model="settle.note" class="field" maxlength="200" />
      </div>
      <p v-if="!data.wallets.length" class="text-sm text-muted">ต้องมีกระเป๋าก่อน <NuxtLink to="/wallets" class="text-accent">สร้างกระเป๋า</NuxtLink></p>
      <p v-if="settleError" class="text-sm text-expense">{{ settleError }}</p>
      <button class="btn btn-primary" :disabled="busy || !data.wallets.length">{{ net > 0 ? 'บันทึกรับคืน' : 'บันทึกจ่ายคืน' }}</button>
      <p class="text-xs text-muted">
        ใช้ช่องนี้เมื่อรับหรือจ่ายเป็นยอดรวมหรือบางส่วน (ไม่ผูกกับรายการ) ถ้าต้องการให้รายการไหนขึ้น PAID กดปุ่ม PENDING ที่รายการนั้นด้านล่าง เงินจะเข้า/ออกกระเป๋าที่เลือกไว้ในช่องนี้
      </p>
    </form>

    <!-- Ledger -->
    <h2 class="section-label mb-2 mt-8">ประวัติรายการ</h2>
    <p v-if="itemError" class="mb-2 break-words rounded-lg bg-expense/10 px-4 py-3 text-sm text-expense">{{ itemError }}</p>
    <div v-if="!loaded && !history.length" class="card h-24 animate-pulse bg-ink/5"></div>
    <p v-else-if="!history.length" class="card px-4 py-4 text-sm text-muted">
      ยังไม่มีรายการ ตอนบันทึกรายจ่าย เลือก "หาร 2" หรือเลือกว่า {{ partner }} เป็นคนจ่าย แล้วรายการจะมาแสดงที่นี่
    </p>
    <ul v-else class="card divide-y divide-line overflow-hidden">
      <li v-for="t in visible" :key="t.id" class="flex items-center justify-between gap-4 px-4 py-3">
        <div class="min-w-0">
          <div class="truncate text-[15px]">{{ t.title }}</div>
          <div class="truncate text-xs text-muted">
            {{ formatDate(t.occurred_at) }} · {{ t.kind }}<template v-if="t.category && t.title !== t.category"> · {{ t.category }}</template>
          </div>
          <button
            v-if="t.type === 'expense'" type="button"
            class="mt-1.5 inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold transition disabled:opacity-50"
            :class="t.is_settled ? 'bg-emerald-500/15 text-emerald-600 hover:bg-emerald-500/25' : 'bg-amber-500/15 text-amber-600 hover:bg-amber-500/25'"
            :disabled="busy"
            @click="toggleItem(t)"
          >{{ t.is_settled ? '✓ PAID' : '⏳ PENDING' }}</button>
        </div>
        <div class="shrink-0 text-right">
          <div class="num text-[15px] font-medium">{{ t.delta > 0 ? '+' : '−' }}{{ formatMoney(Math.abs(t.delta)) }}</div>
          <div class="num text-xs text-muted">ค้าง {{ t.balance === 0 ? '0.00' : (t.balance > 0 ? '+' : '−') + formatMoney(Math.abs(t.balance)) }}</div>
        </div>
      </li>
    </ul>
    <button v-if="history.length > 30" class="mt-3 text-sm text-accent" @click="showAll = !showAll">
      {{ showAll ? 'แสดงเฉพาะ 30 รายการล่าสุด' : `ดูทั้งหมด (${history.length} รายการ)` }}
    </button>
    <p v-if="history.length" class="mt-3 px-1 text-xs text-muted">
      ตัวเลขใหญ่คือการเปลี่ยนแปลงของยอดค้าง (+ {{ partner }} ติดเรามากขึ้น · − น้อยลง หรือเราติดมากขึ้น) ตัวเลข "ค้าง" คือยอดสุทธิหลังรายการนั้น (+ {{ partner }} ติดเรา · − เราติด {{ partner }})
    </p>
  </div>
</template>
