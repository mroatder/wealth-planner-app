<script setup>
const supabase = useSupabaseClient();
const user = useSupabaseUser();
const uid = computed(() => user.value?.id ?? user.value?.sub);

const STATUS_LABEL = { active: 'กำลังออม', completed: 'สำเร็จ', cancelled: 'ยกเลิก' };
const toNumber = (s) => Number(String(s ?? '').replace(/,/g, ''));

// ---------- data ----------
const { data, refresh, loaded } = useLoad('goals', async () => {
  const [g, w] = await Promise.all([
    supabase.from('goal_progress').select('goal_id,name,target_amount,deadline,status,saved,percent').order('status').order('name'),
    supabase.from('wallet_balances').select('wallet_id,name,balance').order('name'),
  ]);
  if (g.error) throw g.error;
  if (w.error) throw w.error;
  return {
    goals: g.data.map((x) => ({ ...x, target_amount: Number(x.target_amount), saved: Number(x.saved), percent: Number(x.percent) })),
    wallets: w.data,
  };
}, { default: () => ({ goals: [], wallets: [] }) });

const goals = computed(() => data.value.goals);
const wallets = computed(() => data.value.wallets);
const active = computed(() => goals.value.filter((g) => g.status === 'active'));
const closed = computed(() => goals.value.filter((g) => g.status !== 'active'));
const totalSaved = computed(() => goals.value.reduce((s, g) => s + g.saved, 0));

function monthlyNeeded(g) {
  if (!g.deadline || g.status !== 'active') return null;
  const remaining = g.target_amount - g.saved;
  if (remaining <= 0) return null;
  const now = new Date();
  const end = new Date(g.deadline);
  const months = (end.getFullYear() - now.getFullYear()) * 12 + (end.getMonth() - now.getMonth());
  return months >= 1 ? remaining / months : null;
}
const overdue = (g) => g.status === 'active' && g.deadline && new Date(g.deadline) < new Date(new Date().toDateString()) && g.saved < g.target_amount;
const fmtDeadline = (d) => new Date(d).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' });

// ---------- add goal ----------
const adding = ref(false);
const draft = reactive({ name: '', target: '', deadline: '' });
const addError = ref('');
const busy = ref(false);

async function addGoal() {
  addError.value = '';
  const target = toNumber(draft.target);
  if (!draft.name.trim()) return (addError.value = 'กรุณาตั้งชื่อเป้าหมาย');
  if (!(target > 0)) return (addError.value = 'กรุณากรอกจำนวนเงินเป้าหมาย');
  busy.value = true;
  const { error } = await supabase.from('goals').insert({
    user_id: uid.value, name: draft.name.trim(), target_amount: target, deadline: draft.deadline || null,
  });
  busy.value = false;
  if (error) return (addError.value = error.message);
  Object.assign(draft, { name: '', target: '', deadline: '' });
  adding.value = false;
  await refresh();
}

// ---------- open a goal: move money / edit ----------
const openId = ref(null);
const mode = ref('deposit'); // deposit | withdraw | edit
const move = reactive({ amount: '', walletId: '' });
const edit = reactive({ name: '', target: '', deadline: '' });
const panelError = ref('');

function open(g) {
  if (openId.value === g.goal_id) return (openId.value = null);
  openId.value = g.goal_id;
  mode.value = g.status === 'active' ? 'deposit' : 'withdraw';
  move.amount = '';
  move.walletId = wallets.value[0]?.wallet_id ?? '';
  Object.assign(edit, { name: g.name, target: String(g.target_amount), deadline: g.deadline ?? '' });
  panelError.value = '';
}

const current = computed(() => goals.value.find((g) => g.goal_id === openId.value));

async function submitMove() {
  panelError.value = '';
  const amount = toNumber(move.amount);
  if (!(amount > 0)) return (panelError.value = 'กรุณากรอกจำนวนเงิน');
  if (!move.walletId) return (panelError.value = 'กรุณาเลือกกระเป๋า');
  if (mode.value === 'withdraw' && amount > current.value.saved) return (panelError.value = 'ถอนเกินยอดที่ออมไว้');
  busy.value = true;
  const { error } = await supabase.from('transactions').insert({
    user_id: uid.value,
    type: mode.value === 'deposit' ? 'goal_deposit' : 'goal_withdraw',
    amount,
    wallet_id: move.walletId,
    goal_id: openId.value,
    occurred_at: new Date().toISOString(),
    note: mode.value === 'deposit' ? 'ออมเข้าเป้าหมาย' : 'ถอนจากเป้าหมาย',
  });
  busy.value = false;
  if (error) return (panelError.value = error.message);
  move.amount = '';
  await refresh();
}

async function saveEdit() {
  panelError.value = '';
  const target = toNumber(edit.target);
  if (!edit.name.trim()) return (panelError.value = 'กรุณาตั้งชื่อเป้าหมาย');
  if (!(target > 0)) return (panelError.value = 'กรุณากรอกจำนวนเงินเป้าหมาย');
  busy.value = true;
  const { error } = await supabase.from('goals')
    .update({ name: edit.name.trim(), target_amount: target, deadline: edit.deadline || null })
    .eq('id', openId.value);
  busy.value = false;
  if (error) return (panelError.value = error.message);
  await refresh();
}

async function setStatus(status) {
  busy.value = true;
  const { error } = await supabase.from('goals').update({ status }).eq('id', openId.value);
  busy.value = false;
  if (error) return (panelError.value = error.message);
  await refresh();
}
</script>

<template>
  <div class="mx-auto max-w-3xl">
    <div class="flex items-end justify-between gap-4">
      <h1 class="title">เป้าหมาย</h1>
      <button class="btn btn-primary" @click="adding = !adding">{{ adding ? 'ยกเลิก' : 'เพิ่มเป้าหมาย' }}</button>
    </div>

    <section v-if="goals.length" class="card mt-6 px-5 py-4">
      <div class="text-[13px] font-medium text-muted">เงินออมในเป้าหมายทั้งหมด</div>
      <div class="num mt-1 text-[28px] font-bold leading-tight tracking-tight">
        {{ formatMoney(totalSaved) }} <span class="text-base font-medium text-muted">บาท</span>
      </div>
    </section>

    <form v-if="adding" class="card mt-4 space-y-4 p-5" @submit.prevent="addGoal">
      <div>
        <label class="label" for="g-name">ชื่อเป้าหมาย</label>
        <input id="g-name" v-model="draft.name" class="field" placeholder="เช่น เงินสำรองฉุกเฉิน, ลงทุน" />
      </div>
      <div class="grid gap-4 sm:grid-cols-2">
        <div>
          <label class="label" for="g-target">จำนวนเงินเป้าหมาย (บาท)</label>
          <input id="g-target" v-model="draft.target" inputmode="decimal" class="field num" />
        </div>
        <div>
          <label class="label" for="g-date">กำหนดเสร็จ <span class="text-faint">(ไม่บังคับ)</span></label>
          <input id="g-date" v-model="draft.deadline" type="date" class="field" />
        </div>
      </div>
      <p v-if="addError" class="text-sm text-expense">{{ addError }}</p>
      <button class="btn btn-primary" :disabled="busy">บันทึก</button>
    </form>

    <div v-if="!loaded && !goals.length" class="card mt-6 h-24 animate-pulse bg-ink/5"></div>
    <p v-else-if="!goals.length" class="card mt-6 px-4 py-4 text-sm text-muted">ยังไม่มีเป้าหมาย กด "เพิ่มเป้าหมาย" เพื่อเริ่มต้น เช่น เงินสำรองฉุกเฉินหรือออมเพื่อลงทุน</p>

    <template v-for="group in [{ title: 'กำลังออม', list: active }, { title: 'สำเร็จ / ยกเลิก', list: closed }]" :key="group.title">
      <template v-if="group.list.length">
        <h2 class="section-label mb-2 mt-8">{{ group.title }}</h2>
        <ul class="card divide-y divide-line overflow-hidden">
          <li v-for="g in group.list" :key="g.goal_id">
            <button class="block w-full px-4 py-3.5 text-left transition hover:bg-ink/[0.03]" @click="open(g)">
              <div class="flex items-baseline justify-between gap-4">
                <div class="truncate text-[15px] font-medium">{{ g.name }}</div>
                <div class="num shrink-0 text-sm text-muted">{{ g.percent.toFixed(0) }}%</div>
              </div>
              <div class="mt-2 h-2 overflow-hidden rounded-full bg-ink/10">
                <div class="h-full rounded-full transition-all" :class="g.status === 'completed' || g.percent >= 100 ? 'bg-income' : 'bg-accent'" :style="{ width: g.percent + '%' }"></div>
              </div>
              <div class="num mt-1.5 flex flex-wrap justify-between gap-x-4 text-xs text-muted">
                <span>{{ formatMoney(g.saved) }} / {{ formatMoney(g.target_amount) }}</span>
                <span v-if="g.status !== 'active'">{{ STATUS_LABEL[g.status] }}</span>
                <span v-else-if="overdue(g)" class="text-expense">เลยกำหนด {{ fmtDeadline(g.deadline) }}</span>
                <span v-else-if="g.deadline">ถึง {{ fmtDeadline(g.deadline) }}<template v-if="monthlyNeeded(g)"> · เดือนละ ~{{ formatMoney(monthlyNeeded(g)) }}</template></span>
              </div>
            </button>

            <div v-if="openId === g.goal_id" class="space-y-4 bg-ink/[0.03] px-4 py-4">
              <div class="segmented grid-cols-3">
                <button type="button" :aria-pressed="mode === 'deposit'" :disabled="g.status !== 'active'" @click="mode = 'deposit'">ออมเพิ่ม</button>
                <button type="button" :aria-pressed="mode === 'withdraw'" @click="mode = 'withdraw'">ถอน</button>
                <button type="button" :aria-pressed="mode === 'edit'" @click="mode = 'edit'">แก้ไข</button>
              </div>

              <form v-if="mode !== 'edit'" class="space-y-4" @submit.prevent="submitMove">
                <div class="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label class="label" :for="`m-amt-${g.goal_id}`">จำนวนเงิน (บาท)</label>
                    <input :id="`m-amt-${g.goal_id}`" v-model="move.amount" inputmode="decimal" class="field num" />
                  </div>
                  <div>
                    <label class="label" :for="`m-w-${g.goal_id}`">{{ mode === 'deposit' ? 'จากกระเป๋า' : 'เข้ากระเป๋า' }}</label>
                    <select :id="`m-w-${g.goal_id}`" v-model="move.walletId" class="field">
                      <option v-for="w in wallets" :key="w.wallet_id" :value="w.wallet_id">{{ w.name }} · {{ formatMoney(w.balance) }}</option>
                    </select>
                  </div>
                </div>
                <p v-if="!wallets.length" class="text-sm text-muted">ต้องมีกระเป๋าก่อน</p>
                <p v-if="panelError" class="text-sm text-expense">{{ panelError }}</p>
                <button class="btn btn-primary" :disabled="busy || !wallets.length">{{ mode === 'deposit' ? 'ออมเข้าเป้าหมาย' : 'ถอนเข้ากระเป๋า' }}</button>
              </form>

              <form v-else class="space-y-4" @submit.prevent="saveEdit">
                <div>
                  <label class="label" :for="`e-name-${g.goal_id}`">ชื่อเป้าหมาย</label>
                  <input :id="`e-name-${g.goal_id}`" v-model="edit.name" class="field" />
                </div>
                <div class="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label class="label" :for="`e-t-${g.goal_id}`">เป้าหมาย (บาท)</label>
                    <input :id="`e-t-${g.goal_id}`" v-model="edit.target" inputmode="decimal" class="field num" />
                  </div>
                  <div>
                    <label class="label" :for="`e-d-${g.goal_id}`">กำหนดเสร็จ</label>
                    <input :id="`e-d-${g.goal_id}`" v-model="edit.deadline" type="date" class="field" />
                  </div>
                </div>
                <p v-if="panelError" class="text-sm text-expense">{{ panelError }}</p>
                <div class="flex flex-wrap items-center justify-between gap-3">
                  <button class="btn btn-primary" :disabled="busy">บันทึก</button>
                  <div class="flex gap-4 text-sm">
                    <button v-if="g.status === 'active'" type="button" class="text-accent" @click="setStatus('completed')">ทำเครื่องหมายสำเร็จ</button>
                    <button v-if="g.status === 'active'" type="button" class="text-expense" @click="setStatus('cancelled')">ยกเลิกเป้าหมาย</button>
                    <button v-else type="button" class="text-accent" @click="setStatus('active')">กลับมาออมต่อ</button>
                  </div>
                </div>
                <p v-if="g.status === 'active'" class="text-xs text-muted">ถ้ายกเลิก เงินที่ออมไว้ยังอยู่จนกว่าจะกด "ถอน" กลับเข้ากระเป๋า</p>
              </form>
            </div>
          </li>
        </ul>
      </template>
    </template>
  </div>
</template>
