<script setup>
const supabase = useSupabaseClient();
const user = useSupabaseUser();
const uid = computed(() => user.value?.id ?? user.value?.sub);

const WALLET_TYPES = { cash: 'เงินสด', bank: 'บัญชีธนาคาร', credit_card: 'บัตรเครดิต', investment: 'การลงทุน', other: 'อื่นๆ' };

// ---------- data ----------
const { data, refresh, loaded } = useLoad('wallets-page', async () => {
  const [wallets, balances, net] = await Promise.all([
    supabase.from('wallets').select('id,name,type,initial_balance').eq('is_archived', false).order('created_at'),
    supabase.from('wallet_balances').select('wallet_id,balance'),
    supabase.from('net_worth').select('net_worth').maybeSingle(),
  ]);
  for (const r of [wallets, balances, net]) if (r.error) throw r.error;
  const balanceOf = Object.fromEntries(balances.data.map((b) => [b.wallet_id, Number(b.balance)]));
  return {
    wallets: wallets.data.map((w) => ({ ...w, initial_balance: Number(w.initial_balance), balance: balanceOf[w.id] ?? 0 })),
    netWorth: Number(net.data?.net_worth ?? 0),
  };
}, { default: () => ({ wallets: [], netWorth: 0 }) });

const wallets = computed(() => data.value.wallets);
const walletsTotal = computed(() => wallets.value.reduce((s, w) => s + w.balance, 0));
const inGoals = computed(() => data.value.netWorth - walletsTotal.value);

// ---------- add ----------
const adding = ref(false);
const draft = reactive({ name: '', type: 'cash', initial: '0' });
const addError = ref('');
const busy = ref(false);

function friendly(err) {
  return err.code === '23505' ? 'มีกระเป๋าชื่อนี้อยู่แล้ว' : err.message;
}

async function addWallet() {
  addError.value = '';
  if (!draft.name.trim()) return (addError.value = 'กรุณาตั้งชื่อกระเป๋า');
  const initial = Number(String(draft.initial).replace(/,/g, '') || 0);
  if (Number.isNaN(initial)) return (addError.value = 'ยอดทั้งหมดไม่ถูกต้อง');
  busy.value = true;
  const { error } = await supabase.from('wallets').insert({
    user_id: uid.value, name: draft.name.trim(), type: draft.type, initial_balance: initial,
  });
  busy.value = false;
  if (error) return (addError.value = friendly(error));
  Object.assign(draft, { name: '', type: 'cash', initial: '0' });
  adding.value = false;
  await refresh();
}

// ---------- edit / archive ----------
const editingId = ref(null);
const edit = reactive({ name: '', type: 'cash', initial: '0' });
const editError = ref('');
const confirmArchive = ref(false);

function startEdit(w) {
  if (editingId.value === w.id) return (editingId.value = null);
  editingId.value = w.id;
  Object.assign(edit, { name: w.name, type: w.type, initial: String(w.initial_balance) });
  editError.value = '';
  confirmArchive.value = false;
}

async function saveEdit() {
  editError.value = '';
  if (!edit.name.trim()) return (editError.value = 'กรุณาตั้งชื่อกระเป๋า');
  const initial = Number(String(edit.initial).replace(/,/g, '') || 0);
  if (Number.isNaN(initial)) return (editError.value = 'ยอดทั้งหมดไม่ถูกต้อง');
  busy.value = true;
  const { error } = await supabase.from('wallets')
    .update({ name: edit.name.trim(), type: edit.type, initial_balance: initial })
    .eq('id', editingId.value);
  busy.value = false;
  if (error) return (editError.value = friendly(error));
  editingId.value = null;
  await refresh();
}

async function archive() {
  busy.value = true;
  const { error } = await supabase.from('wallets').update({ is_archived: true }).eq('id', editingId.value);
  busy.value = false;
  if (error) return (editError.value = friendly(error));
  editingId.value = null;
  await refresh();
}
</script>

<template>
  <div class="mx-auto max-w-3xl">
    <div class="flex items-end justify-between gap-4">
      <h1 class="title">กระเป๋า</h1>
      <button class="btn btn-primary" @click="adding = !adding">{{ adding ? 'ยกเลิก' : 'เพิ่มกระเป๋า' }}</button>
    </div>

    <!-- Net worth -->
    <section class="card mt-6 px-5 py-4">
      <div class="text-[13px] font-medium text-muted">Net Worth</div>
      <div class="num mt-1 text-[34px] font-bold leading-tight tracking-tight" :class="data.netWorth < 0 ? 'text-expense' : ''">
        {{ formatMoney(data.netWorth) }} <span class="text-base font-medium text-muted">บาท</span>
      </div>
      <div class="mt-1 text-xs text-muted">
        กระเป๋า {{ formatMoney(walletsTotal) }}<template v-if="inGoals"> · เงินในเป้าหมาย {{ formatMoney(inGoals) }}</template>
      </div>
    </section>

    <!-- Add form -->
    <form v-if="adding" class="card mt-4 space-y-4 p-5" @submit.prevent="addWallet">
      <div>
        <label class="label" for="n-name">ชื่อกระเป๋า</label>
        <input id="n-name" v-model="draft.name" class="field" placeholder="เช่น เงินสด, กสิกร, บัตร KTC" />
      </div>
      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="label" for="n-type">ประเภท</label>
          <select id="n-type" v-model="draft.type" class="field">
            <option v-for="(label, key) in WALLET_TYPES" :key="key" :value="key">{{ label }}</option>
          </select>
        </div>
        <div>
          <label class="label" for="n-init">ยอดทั้งหมด</label>
          <input id="n-init" v-model="draft.initial" inputmode="decimal" class="field num" />
        </div>
      </div>
      <p v-if="draft.type === 'credit_card'" class="text-xs text-muted">บัตรเครดิต: ใส่ยอดค้างชำระเป็นเลขติดลบ เช่น -5000</p>
      <p v-if="addError" class="text-sm text-expense">{{ addError }}</p>
      <button class="btn btn-primary" :disabled="busy">บันทึก</button>
    </form>

    <!-- List -->
    <h2 class="section-label mb-2 mt-8">บัญชีทั้งหมด</h2>
    <div v-if="!loaded && !wallets.length" class="card h-24 animate-pulse bg-ink/5"></div>
    <p v-else-if="!wallets.length" class="card px-4 py-4 text-sm text-muted">ยังไม่มีกระเป๋า กด "เพิ่มกระเป๋า" เพื่อเริ่มต้น</p>
    <ul v-else class="card divide-y divide-line overflow-hidden">
      <li v-for="w in wallets" :key="w.id">
        <button class="flex w-full items-center justify-between gap-4 px-4 py-3 text-left transition hover:bg-ink/[0.03]" @click="startEdit(w)">
          <div class="min-w-0">
            <div class="truncate text-[15px]">{{ w.name }}</div>
            <div class="text-xs text-muted">{{ WALLET_TYPES[w.type] }}</div>
          </div>
          <div class="num shrink-0 text-[15px] font-medium" :class="w.balance < 0 ? 'text-expense' : ''">
            {{ formatMoney(w.balance) }}
          </div>
        </button>

        <!-- Inline editor -->
        <form v-if="editingId === w.id" class="space-y-4 bg-ink/[0.03] px-4 py-4" @submit.prevent="saveEdit">
          <div>
            <label class="label" :for="`e-name-${w.id}`">ชื่อกระเป๋า</label>
            <input :id="`e-name-${w.id}`" v-model="edit.name" class="field" />
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="label" :for="`e-type-${w.id}`">ประเภท</label>
              <select :id="`e-type-${w.id}`" v-model="edit.type" class="field">
                <option v-for="(label, key) in WALLET_TYPES" :key="key" :value="key">{{ label }}</option>
              </select>
            </div>
            <div>
              <label class="label" :for="`e-init-${w.id}`">ยอดทั้งหมด</label>
              <input :id="`e-init-${w.id}`" v-model="edit.initial" inputmode="decimal" class="field num" />
            </div>
          </div>
          <p v-if="editError" class="text-sm text-expense">{{ editError }}</p>
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div class="flex gap-2">
              <button class="btn btn-primary" :disabled="busy">บันทึก</button>
              <button type="button" class="btn btn-quiet" @click="editingId = null">ยกเลิก</button>
            </div>
            <div class="text-sm">
              <button v-if="!confirmArchive" type="button" class="text-expense" @click="confirmArchive = true">เก็บถาวร</button>
              <span v-else class="flex items-center gap-3">
                <span class="text-muted">ซ่อนกระเป๋านี้? ประวัติรายการยังอยู่</span>
                <button type="button" class="font-medium text-expense" :disabled="busy" @click="archive">ยืนยัน</button>
              </span>
            </div>
          </div>
        </form>
      </li>
    </ul>
  </div>
</template>
