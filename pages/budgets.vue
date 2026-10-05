<script setup>
const supabase = useSupabaseClient();
const user = useSupabaseUser();
const uid = computed(() => user.value?.id ?? user.value?.sub);

// ---------- month navigation ----------
const pad = (n) => String(n).padStart(2, '0');
const cursor = ref(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
const keyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`;
const monthKey = computed(() => keyOf(cursor.value));
const monthLabel = computed(() => cursor.value.toLocaleDateString('th-TH', { month: 'long', year: 'numeric' }));
const shift = (n) => { cursor.value = new Date(cursor.value.getFullYear(), cursor.value.getMonth() + n, 1); };

// ---------- data ----------
const { data, refresh, loaded } = useLoad('budgets', async () => {
  const [b, c] = await Promise.all([
    supabase.from('budget_progress')
      .select('id,category_id,category_name,amount_limit,spent,percent_used')
      .eq('month', monthKey.value).order('category_name'),
    supabase.from('categories').select('id,name').eq('type', 'expense').order('name'),
  ]);
  if (b.error) throw b.error;
  if (c.error) throw c.error;
  return {
    budgets: b.data.map((x) => ({
      ...x, amount_limit: Number(x.amount_limit), spent: Number(x.spent), percent_used: Number(x.percent_used),
    })),
    categories: c.data,
  };
}, { watch: [monthKey], default: () => ({ budgets: [], categories: [] }) });

const budgets = computed(() => data.value.budgets);
const freeCategories = computed(() => {
  const used = new Set(budgets.value.map((b) => b.category_id));
  return data.value.categories.filter((c) => !used.has(c.id));
});
const totalLimit = computed(() => budgets.value.reduce((s, b) => s + b.amount_limit, 0));
const totalSpent = computed(() => budgets.value.reduce((s, b) => s + b.spent, 0));
const totalPercent = computed(() => (totalLimit.value ? (totalSpent.value / totalLimit.value) * 100 : 0));

const barColor = (p) => (p >= 100 ? 'bg-expense' : p >= 80 ? 'bg-warn' : 'bg-accent');
const toNumber = (s) => Number(String(s).replace(/,/g, ''));
const friendly = (err) => (err.code === '23505' ? 'หมวดหมู่นี้มีงบประมาณในเดือนนี้แล้ว' : err.message);

// ---------- add ----------
const adding = ref(false);
const draft = reactive({ categoryId: '', limit: '' });
const addError = ref('');
const busy = ref(false);

async function addBudget() {
  addError.value = '';
  const limit = toNumber(draft.limit);
  if (!draft.categoryId) return (addError.value = 'กรุณาเลือกหมวดหมู่');
  if (!(limit > 0)) return (addError.value = 'กรุณากรอกวงเงินที่มากกว่า 0');
  busy.value = true;
  const { error } = await supabase.from('budgets').insert({
    user_id: uid.value, category_id: draft.categoryId, amount_limit: limit, month: monthKey.value,
  });
  busy.value = false;
  if (error) return (addError.value = friendly(error));
  Object.assign(draft, { categoryId: '', limit: '' });
  adding.value = false;
  await refresh();
}

// ---------- copy from previous month ----------
const copyMsg = ref('');
async function copyPrevious() {
  copyMsg.value = '';
  const prev = new Date(cursor.value.getFullYear(), cursor.value.getMonth() - 1, 1);
  const { data: rows, error } = await supabase.from('budgets').select('category_id,amount_limit').eq('month', keyOf(prev));
  if (error) return (copyMsg.value = error.message);
  const have = new Set(budgets.value.map((b) => b.category_id));
  const todo = rows.filter((r) => !have.has(r.category_id));
  if (!todo.length) return (copyMsg.value = 'ไม่มีงบจากเดือนก่อนที่ต้องคัดลอก');
  busy.value = true;
  const { error: err } = await supabase.from('budgets').insert(
    todo.map((r) => ({ user_id: uid.value, category_id: r.category_id, amount_limit: r.amount_limit, month: monthKey.value })),
  );
  busy.value = false;
  if (err) return (copyMsg.value = friendly(err));
  await refresh();
}

// ---------- edit / delete ----------
const editingId = ref(null);
const editLimit = ref('');
const editError = ref('');
const confirmDelete = ref(false);

function startEdit(b) {
  if (editingId.value === b.id) return (editingId.value = null);
  editingId.value = b.id;
  editLimit.value = String(b.amount_limit);
  editError.value = '';
  confirmDelete.value = false;
}

async function saveEdit() {
  editError.value = '';
  const limit = toNumber(editLimit.value);
  if (!(limit > 0)) return (editError.value = 'กรุณากรอกวงเงินที่มากกว่า 0');
  busy.value = true;
  const { error } = await supabase.from('budgets').update({ amount_limit: limit }).eq('id', editingId.value);
  busy.value = false;
  if (error) return (editError.value = error.message);
  editingId.value = null;
  await refresh();
}

async function remove() {
  busy.value = true;
  const { data: gone, error } = await supabase.rpc('delete_budget', { p_id: editingId.value }); // POST, not DELETE
  busy.value = false;
  if (error) return (editError.value = /could not find the function|PGRST202/i.test(`${error.message} ${error.code}`) ? 'ยังไม่ได้รัน migration 004_delete_functions.sql ใน Supabase' : error.message);
  if (!gone) return (editError.value = 'ลบไม่สำเร็จ: ไม่พบงบนี้');
  editingId.value = null;
  await refresh();
}
</script>

<template>
  <div class="mx-auto max-w-3xl">
    <div class="flex items-end justify-between gap-4">
      <h1 class="title">งบประมาณ</h1>
      <button class="btn btn-primary" :disabled="!freeCategories.length && !adding" @click="adding = !adding">
        {{ adding ? 'ยกเลิก' : 'ตั้งงบ' }}
      </button>
    </div>

    <!-- Month switcher -->
    <MonthPicker v-model="cursor" class="mt-5" />

    <!-- Summary -->
    <section v-if="budgets.length" class="card mt-4 px-5 py-4">
      <div class="flex items-baseline justify-between gap-3">
        <div class="text-[13px] font-medium text-muted">ใช้ไปทั้งหมด</div>
        <div class="num text-xs text-muted">{{ totalPercent.toFixed(0) }}%</div>
      </div>
      <div class="num mt-1 text-[28px] font-bold leading-tight tracking-tight">
        {{ formatMoney(totalSpent) }}
        <span class="text-base font-medium text-muted">/ {{ formatMoney(totalLimit) }}</span>
      </div>
      <div class="mt-3 h-2 overflow-hidden rounded-full bg-ink/10">
        <div class="h-full rounded-full transition-all" :class="barColor(totalPercent)" :style="{ width: Math.min(totalPercent, 100) + '%' }"></div>
      </div>
    </section>

    <!-- Add form -->
    <form v-if="adding" class="card mt-4 space-y-4 p-5" @submit.prevent="addBudget">
      <div class="grid gap-4 sm:grid-cols-2">
        <div>
          <label class="label" for="b-cat">หมวดหมู่</label>
          <select id="b-cat" v-model="draft.categoryId" class="field">
            <option value="" disabled>เลือกหมวดหมู่</option>
            <option v-for="c in freeCategories" :key="c.id" :value="c.id">{{ c.name }}</option>
          </select>
        </div>
        <div>
          <label class="label" for="b-limit">วงเงินต่อเดือน (บาท)</label>
          <input id="b-limit" v-model="draft.limit" inputmode="decimal" placeholder="5,000" class="field num" />
        </div>
      </div>
      <p v-if="addError" class="text-sm text-expense">{{ addError }}</p>
      <button class="btn btn-primary" :disabled="busy">บันทึก</button>
    </form>

    <!-- List -->
    <h2 class="section-label mb-2 mt-8">แยกตามหมวดหมู่</h2>
    <div v-if="!loaded && !budgets.length" class="card h-24 animate-pulse bg-ink/5"></div>
    <div v-else-if="!budgets.length" class="card px-4 py-4 text-sm text-muted">
      ยังไม่ได้ตั้งงบสำหรับ{{ monthLabel }}
      <div class="mt-3 flex flex-wrap items-center gap-3">
        <button class="btn btn-quiet" :disabled="busy" @click="copyPrevious">คัดลอกจากเดือนก่อน</button>
        <span v-if="copyMsg" class="text-xs">{{ copyMsg }}</span>
      </div>
    </div>
    <ul v-else class="card divide-y divide-line overflow-hidden">
      <li v-for="b in budgets" :key="b.id">
        <button class="block w-full px-4 py-3 text-left transition hover:bg-ink/[0.03]" @click="startEdit(b)">
          <div class="flex items-baseline justify-between gap-4">
            <div class="truncate text-[15px]">{{ b.category_name }}</div>
            <div class="num shrink-0 text-sm text-muted">
              <span :class="b.percent_used >= 100 ? 'font-medium text-expense' : 'text-ink'">{{ formatMoney(b.spent) }}</span>
              / {{ formatMoney(b.amount_limit) }}
            </div>
          </div>
          <div class="mt-2 h-2 overflow-hidden rounded-full bg-ink/10">
            <div class="h-full rounded-full transition-all" :class="barColor(b.percent_used)" :style="{ width: Math.min(b.percent_used, 100) + '%' }"></div>
          </div>
          <div class="num mt-1.5 text-xs" :class="b.percent_used >= 100 ? 'text-expense' : 'text-muted'">
            {{ b.percent_used >= 100
              ? `เกินงบ ${formatMoney(b.spent - b.amount_limit)}`
              : `เหลือ ${formatMoney(b.amount_limit - b.spent)}` }} · {{ b.percent_used.toFixed(0) }}%
          </div>
        </button>

        <form v-if="editingId === b.id" class="space-y-4 bg-ink/[0.03] px-4 py-4" @submit.prevent="saveEdit">
          <div>
            <label class="label" :for="`e-limit-${b.id}`">วงเงินต่อเดือน (บาท)</label>
            <input :id="`e-limit-${b.id}`" v-model="editLimit" inputmode="decimal" class="field num" />
          </div>
          <p v-if="editError" class="text-sm text-expense">{{ editError }}</p>
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div class="flex gap-2">
              <button class="btn btn-primary" :disabled="busy">บันทึก</button>
              <button type="button" class="btn btn-quiet" @click="editingId = null">ยกเลิก</button>
            </div>
            <div class="text-sm">
              <button v-if="!confirmDelete" type="button" class="text-expense" @click="confirmDelete = true">ลบงบนี้</button>
              <span v-else class="flex items-center gap-3">
                <span class="text-muted">ลบงบของเดือนนี้?</span>
                <button type="button" class="font-medium text-expense" :disabled="busy" @click="remove">ยืนยัน</button>
              </span>
            </div>
          </div>
        </form>
      </li>
    </ul>
  </div>
</template>
