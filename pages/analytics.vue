<script setup>
const supabase = useSupabaseClient();
const user = useSupabaseUser();
const uid = computed(() => user.value?.id ?? user.value?.sub);

// ---------- month navigation ----------
const pad = (n) => String(n).padStart(2, '0');
const now = new Date();
const cursor = ref(new Date(now.getFullYear(), now.getMonth(), 1));
const span = ref(6); // months shown in the trend chart
const keyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
const monthKey = computed(() => keyOf(cursor.value));
const monthLabel = computed(() => cursor.value.toLocaleDateString('th-TH', { month: 'long', year: 'numeric' }));
const monthShort = computed(() => cursor.value.toLocaleDateString('th-TH', { month: 'short' }));
const shift = (n) => { cursor.value = new Date(cursor.value.getFullYear(), cursor.value.getMonth() + n, 1); };

// Thailand wall-clock parts of a timestamp
const bkk = (iso) => new Date(new Date(iso).getTime() + 7 * 3600e3);

// ---------- data: 12 months ending at the selected one ----------
const { data, pending, error: loadErr, loaded, refresh } = useLoad('analytics', async () => {
  const start = new Date(cursor.value.getFullYear(), cursor.value.getMonth() - 11, 1);
  const end = new Date(cursor.value.getFullYear(), cursor.value.getMonth() + 1, 1);
  const from = new Date(`${keyOf(start)}-01T00:00:00+07:00`).toISOString();
  const to = new Date(`${keyOf(end)}-01T00:00:00+07:00`).toISOString();

  // the transactions (possibly several pages) load at the same time as categories and budgets
  const loadRows = async () => {
    const out = [];
    for (let page = 0; ; page++) {
      const { data: part, error } = await supabase.from('transactions')
        .select('type,amount,owed_amount,is_fixed,paid_by_partner,is_shared,note,occurred_at,category_id')
        .in('type', ['income', 'expense']).gte('occurred_at', from).lt('occurred_at', to)
        .order('occurred_at').range(page * 1000, page * 1000 + 999);
      if (error) throw error;
      out.push(...part);
      if (part.length < 1000) break;
    }
    return out;
  };
  const [rows, cats, budgets, goals] = await Promise.all([
    loadRows(),
    supabase.from('categories').select('id,name'),
    supabase.from('budget_progress').select('category_id,category_name,amount_limit,spent,percent_used')
      .eq('month', `${monthKey.value}-01`).order('percent_used', { ascending: false }),
    supabase.from('goals').select('id,name').neq('status', 'cancelled'),
  ]);
  if (cats.error) throw cats.error;
  if (budgets.error) throw budgets.error;
  if (goals.error) throw goals.error;
  return {
    rows,
    goals: goals.data,
    categories: Object.fromEntries(cats.data.map((c) => [c.id, c.name])),
    budgets: budgets.data.map((b) => ({ ...b, spent: Number(b.spent), amount_limit: Number(b.amount_limit), percent_used: Number(b.percent_used) })),
  };
}, { watch: [monthKey], default: () => ({ rows: [], categories: {}, budgets: [], goals: [] }) });

// Expense always means MY share: cost minus what the partner repays (partner-paid rows already store only my share)
const share = (r) => Number(r.amount) - Number(r.owed_amount);
const catName = (id) => data.value.categories[id] ?? 'ไม่ระบุหมวดหมู่';

// every row with its Thai date parts
const rows = computed(() => data.value.rows.map((r) => {
  const d = bkk(r.occurred_at);
  return { ...r, month: d.toISOString().slice(0, 7), day: d.getUTCDate(), dow: d.getUTCDay(), share: r.type === 'expense' ? share(r) : Number(r.amount) };
}));
const monthRows = computed(() => rows.value.filter((r) => r.month === monthKey.value));
const expenses = computed(() => monthRows.value.filter((r) => r.type === 'expense'));

const prevKey = computed(() => keyOf(new Date(cursor.value.getFullYear(), cursor.value.getMonth() - 1, 1)));
const sum = (list, f = (r) => r.share) => list.reduce((s, r) => s + f(r), 0);

// ---------- totals ----------
const income = computed(() => sum(monthRows.value.filter((r) => r.type === 'income')));
const expense = computed(() => sum(expenses.value));
const net = computed(() => income.value - expense.value);
const savingsRate = computed(() => (income.value > 0 ? (net.value / income.value) * 100 : null));
// While the month is still running, compare with the same days of the previous month, not the whole month
const inPrevWindow = (r) => r.month === prevKey.value && (!isCurrentMonth.value || r.day <= elapsedDays.value);
const prevExpense = computed(() => sum(rows.value.filter((r) => r.type === 'expense' && inPrevWindow(r))));
const expenseDelta = computed(() => (prevExpense.value > 0 ? ((expense.value - prevExpense.value) / prevExpense.value) * 100 : null));

// ---------- daily ----------
const isCurrentMonth = computed(() => monthKey.value === keyOf(now));
const daysInMonth = computed(() => new Date(cursor.value.getFullYear(), cursor.value.getMonth() + 1, 0).getDate());
const elapsedDays = computed(() => (isCurrentMonth.value ? bkk(now.toISOString()).getUTCDate() : daysInMonth.value));
const variable = computed(() => expenses.value.filter((r) => !r.is_fixed));
const fixedTotal = computed(() => sum(expenses.value.filter((r) => r.is_fixed)));
const daily = computed(() => {
  const byDay = Array(daysInMonth.value + 1).fill(0);
  for (const r of variable.value) byDay[r.day] += r.share;
  return Array.from({ length: daysInMonth.value }, (_, i) => ({
    key: i + 1, label: String(i + 1), value: byDay[i + 1], tip: `${i + 1} ${monthShort.value}`,
  }));
});
// everyday spending only; fixed bills are added as a lump when projecting the month
const avgPerDay = computed(() => (elapsedDays.value ? sum(variable.value) / elapsedDays.value : 0));
const projected = computed(() => (isCurrentMonth.value && elapsedDays.value < daysInMonth.value ? fixedTotal.value + avgPerDay.value * daysInMonth.value : null));
const peakDay = computed(() => daily.value.reduce((m, d) => (d.value > m.value ? d : m), { value: 0 }));

// ---------- weekday ----------
const DOW = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];
const DOW_FULL = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
const weekday = computed(() => {
  const t = Array(7).fill(0);
  for (const r of variable.value) t[r.dow] += r.share;
  return DOW.map((label, i) => ({ key: i, label, value: t[i], tip: DOW_FULL[i] }));
});
const peakWeekday = computed(() => weekday.value.reduce((m, d) => (d.value > m.value ? d : m), { value: 0 }));

// ---------- categories vs last month ----------
const catTotals = (match) => {
  const m = {};
  for (const r of rows.value) if (r.type === 'expense' && match(r)) m[r.category_id ?? 'none'] = (m[r.category_id ?? 'none'] ?? 0) + r.share;
  return m;
};
const categoryRows = computed(() => {
  const cur = catTotals((r) => r.month === monthKey.value);
  const prev = catTotals(inPrevWindow);
  return [...new Set([...Object.keys(cur), ...Object.keys(prev)])]
    .map((k) => ({ key: k, name: catName(k === 'none' ? null : k), cur: cur[k] ?? 0, prev: prev[k] ?? 0 }))
    .filter((c) => c.cur > 0 || c.prev > 0)
    .sort((a, b) => b.cur - a.cur || b.prev - a.prev);
});
const pie = computed(() => {
  const list = categoryRows.value.filter((c) => c.cur > 0).map((c) => ({ key: c.key, label: c.name, value: c.cur }));
  if (list.length <= 8) return list;
  return [...list.slice(0, 7), { key: 'rest', label: 'อื่นๆ', value: list.slice(7).reduce((s, x) => s + x.value, 0) }];
});
const changePct = (c) => (c.prev > 0 ? ((c.cur - c.prev) / c.prev) * 100 : null);

// ---------- spending patterns ----------
const fixedSplit = computed(() => [
  { label: 'รายจ่ายประจำ', value: sum(expenses.value.filter((r) => r.is_fixed)), color: 'var(--s1)' },
  { label: 'รายจ่ายทั่วไป', value: sum(expenses.value.filter((r) => !r.is_fixed)), color: 'var(--s2)' },
]);
const sharedSplit = computed(() => {
  const isShared = (r) => r.is_shared || Number(r.owed_amount) > 0 || r.paid_by_partner;
  return [
    { label: 'ส่วนตัว', value: sum(expenses.value.filter((r) => !isShared(r))), color: 'var(--s1)' },
    { label: 'หารกับแฟน (ส่วนของเรา)', value: sum(expenses.value.filter(isShared)), color: 'var(--s2)' },
  ];
});

const topExpenses = computed(() => [...expenses.value].sort((a, b) => b.share - a.share).slice(0, 5));

// ---------- trend ----------
const byMonth = computed(() => {
  const m = {};
  for (const r of rows.value) {
    m[r.month] ??= { income: 0, expense: 0 };
    m[r.month][r.type === 'income' ? 'income' : 'expense'] += r.share;
  }
  return m;
});
const trend = computed(() => {
  const out = [];
  for (let i = span.value - 1; i >= 0; i--) {
    const d = new Date(cursor.value.getFullYear(), cursor.value.getMonth() - i, 1);
    const k = keyOf(d);
    out.push({ key: k, label: d.toLocaleDateString('th-TH', { month: 'short' }), income: byMonth.value[k]?.income ?? 0, expense: byMonth.value[k]?.expense ?? 0 });
  }
  return out;
});

// ---------- plain-language takeaways ----------
const insights = computed(() => {
  const out = [];
  if (!expenses.value.length) return out;
  const top = pie.value[0];
  if (top) out.push(`${top.label} เป็นหมวดที่ใช้มากที่สุด ${formatMoney(top.value)} บาท (${((top.value / expense.value) * 100).toFixed(0)}% ของรายจ่าย)`);
  if (expenseDelta.value !== null) {
    out.push(`รายจ่ายเดือนนี้${expenseDelta.value >= 0 ? 'มากกว่า' : 'น้อยกว่า'}เดือนก่อน ${Math.abs(expenseDelta.value).toFixed(0)}% (${formatMoney(Math.abs(expense.value - prevExpense.value))} บาท)`);
  }
  if (peakDay.value.value > 0) out.push(`วันที่ใช้จ่ายทั่วไปมากที่สุดคือวันที่ ${peakDay.value.label} ${monthShort.value} (${formatMoney(peakDay.value.value)} บาท)`);
  if (peakWeekday.value.value > 0) out.push(`ใช้จ่ายทั่วไปรวมสูงสุดในวัน${DOW_FULL[peakWeekday.value.key]}`);
  if (projected.value) out.push(`ใช้จ่ายทั่วไปเฉลี่ยวันละ ${formatMoney(avgPerDay.value)} บาท ถ้าเป็นแบบนี้ต่อไป รายจ่ายสิ้นเดือน (รวมรายจ่ายประจำ) จะอยู่ที่ประมาณ ${formatMoney(projected.value)} บาท`);
  const fixedPct = expense.value ? (fixedSplit.value[0].value / expense.value) * 100 : 0;
  if (fixedPct > 0) out.push(`รายจ่ายประจำคิดเป็น ${fixedPct.toFixed(0)}% ของรายจ่ายทั้งหมด`);
  if (income.value > 0 && fixedTotal.value > 0) out.push(`รายจ่ายประจำใช้ไป ${((fixedTotal.value / income.value) * 100).toFixed(0)}% ของรายได้เดือนนี้ (ที่เหลือคือส่วนที่ปรับลดได้)`);
  const over = data.value.budgets.filter((b) => b.percent_used >= 100);
  if (over.length) out.push(`เกินงบแล้ว ${over.length} หมวด: ${over.map((b) => b.category_name).join(', ')}`);
  return out;
});

// ---------- deeper analysis (the maths lives in utils/analytics.js, covered by npm run test:analytics) ----------
const rawRows = computed(() => data.value.rows);
const monthName = (key) => new Date(`${key}-01T12:00:00`).toLocaleDateString('th-TH', { month: 'short' });

// spending pace: running total this month vs the month before
const paceThis = computed(() => cumulativeByDay(rawRows.value, monthKey.value, isCurrentMonth.value ? elapsedDays.value : Infinity));
const pacePrev = computed(() => cumulativeByDay(rawRows.value, prevKey.value));
const hasPace = computed(() => paceThis.value.some((v) => v) || pacePrev.value.some((v) => v));
const paceSeries = computed(() => [
  { key: 'prev', label: monthName(prevKey.value), color: 'rgb(var(--c-faint))', values: pacePrev.value },
  { key: 'cur', label: monthName(monthKey.value), color: 'var(--s1)', values: paceThis.value },
]);
const paceNote = computed(() => {
  const day = isCurrentMonth.value ? elapsedDays.value : daysInMonth.value;
  const cur = paceThis.value[day - 1];
  const prev = pacePrev.value[Math.min(day, pacePrev.value.length) - 1];
  if (cur == null || prev == null || prev <= 0) return '';
  const diff = cur - prev;
  const where = isCurrentMonth.value ? `ณ วันที่ ${day}` : 'ตลอดเดือน';
  return `${where} ใช้ไปแล้ว ${formatMoney(cur)} บาท เทียบเดือนก่อนช่วงเดียวกัน ${formatMoney(prev)} บาท (${diff >= 0 ? 'มากกว่า' : 'น้อยกว่า'} ${formatMoney(Math.abs(diff))} บาท)`;
});

// while the month is still running, the trend ends at the last COMPLETE month (a half month would always look like a drop)
const trendEndKey = computed(() => (isCurrentMonth.value ? prevKey.value : monthKey.value));
const trends = computed(() => categoryTrends(rawRows.value, trendEndKey.value));
const trendMax = (t) => Math.max(...t.values, 1);

const splitMonths = computed(() => monthlySplit(rawRows.value, monthKey.value));
const splitMax = computed(() => Math.max(1, ...splitMonths.value.map((m) => m.personal + m.shared)));

const recurring = computed(() => findRecurring(rawRows.value));
const recurringMonthly = computed(() => recurring.value.reduce((sum, r) => sum + r.monthlyAvg, 0));

// from history to a budget / a goal (useful while you have not set any yet)
const profile = computed(() => savingsProfile(rawRows.value, monthKey.value));
const fundPlans = computed(() => [3, 6].map((cover) => emergencyFundPlan(profile.value, cover)).filter(Boolean));
const goalName = (plan) => `เงินสำรองฉุกเฉิน ${plan.cover} เดือน`;
const goalExists = (plan) => data.value.goals.some((g) => g.name === goalName(plan));
const budgetedIds = computed(() => new Set(data.value.budgets.map((b) => b.category_id)));
const budgetSuggestions = computed(() => suggestBudgets(rawRows.value, monthKey.value, { exclude: budgetedIds.value }));

const applying = ref(false);
const actionMsg = ref('');

async function applyBudgets(list) {
  if (!list.length) return;
  actionMsg.value = '';
  applying.value = true;
  try {
    const { error } = await supabase.from('budgets').insert(list.map((s) => ({
      user_id: uid.value, category_id: s.categoryId, amount_limit: s.suggested, month: `${monthKey.value}-01`,
    })));
    if (error) throw error;
    actionMsg.value = `ตั้งงบสำหรับ${monthLabel.value}แล้ว ${list.length} หมวด ดูและแก้ไขได้ที่หน้างบประมาณ`;
    await refresh();
  } catch (e) {
    actionMsg.value = e?.message ?? String(e);
  } finally {
    applying.value = false;
  }
}

async function createGoal(plan) {
  actionMsg.value = '';
  applying.value = true;
  try {
    const { error } = await supabase.from('goals').insert({ user_id: uid.value, name: goalName(plan), target_amount: plan.target });
    if (error) throw error;
    actionMsg.value = `สร้างเป้าหมาย “${goalName(plan)}” แล้ว ไปออมเข้าเป้าหมายได้ที่หน้าเป้าหมาย`;
    await refresh();
  } catch (e) {
    actionMsg.value = e?.message ?? String(e);
  } finally {
    applying.value = false;
  }
}

const barColor = (p) => (p >= 100 ? 'bg-expense' : p >= 80 ? 'bg-warn' : 'bg-accent');
</script>

<template>
  <div :class="loaded ? '' : 'opacity-60 transition-opacity'">
    <h1 class="title">วิเคราะห์</h1>

    <p v-if="loadErr" class="mt-4 rounded-lg bg-expense/10 px-4 py-3 text-sm text-expense">โหลดข้อมูลไม่สำเร็จ: {{ loadErr.message }}</p>

    <MonthPicker v-model="cursor" class="mt-5" />

    <!-- Month summary -->
    <section class="mt-4 grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-4">
      <div class="card px-3.5 py-3 sm:px-5 sm:py-4">
        <div class="truncate text-xs font-medium text-muted sm:text-[13px]">รายรับ</div>
        <div class="num mt-1 text-[16px] font-bold tracking-tight sm:text-[20px]">{{ formatMoney(income) }}</div>
      </div>
      <div class="card px-3.5 py-3 sm:px-5 sm:py-4">
        <div class="truncate text-xs font-medium text-muted sm:text-[13px]">รายจ่าย (ส่วนของเรา)</div>
        <div class="num mt-1 text-[16px] font-bold tracking-tight sm:text-[20px]">{{ formatMoney(expense) }}</div>
        <div v-if="expenseDelta !== null" class="num mt-0.5 text-[11px] text-muted sm:text-xs">{{ expenseDelta >= 0 ? '+' : '−' }}{{ Math.abs(expenseDelta).toFixed(0) }}% จากเดือนก่อน</div>
      </div>
      <div class="card px-3.5 py-3 sm:px-5 sm:py-4">
        <div class="truncate text-xs font-medium text-muted sm:text-[13px]">คงเหลือ</div>
        <div class="num mt-1 text-[16px] font-bold tracking-tight sm:text-[20px]" :class="net < 0 ? 'text-expense' : ''">{{ formatMoney(net) }}</div>
        <div v-if="savingsRate !== null" class="num mt-0.5 text-[11px] text-muted sm:text-xs">ออม {{ savingsRate.toFixed(0) }}%</div>
      </div>
      <div class="card px-3.5 py-3 sm:px-5 sm:py-4">
        <div class="truncate text-xs font-medium text-muted sm:text-[13px]">เฉลี่ยต่อวัน (ไม่รวมประจำ)</div>
        <div class="num mt-1 text-[16px] font-bold tracking-tight sm:text-[20px]">{{ formatMoney(avgPerDay) }}</div>
        <div v-if="projected" class="num mt-0.5 text-[11px] text-muted sm:text-xs">คาดสิ้นเดือน {{ formatMoney(projected) }}</div>
      </div>
    </section>

    <!-- Takeaways -->
    <section v-if="insights.length" class="card mt-4 p-5">
      <h2 class="mb-3 text-[15px] font-semibold">สรุปเดือนนี้</h2>
      <ul class="space-y-2 text-[14px]">
        <li v-for="line in insights" :key="line" class="flex gap-2.5"><span class="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-accent"></span><span>{{ line }}</span></li>
      </ul>
    </section>

    <!-- Pace: running total of spending, this month against last month -->
    <section v-if="hasPace" class="card mt-4 p-5">
      <h2 class="mb-1 text-[15px] font-semibold">จังหวะการใช้จ่าย</h2>
      <p class="mb-3 text-xs text-muted">รายจ่ายสะสมของเราตามวันที่ เทียบกับเดือนก่อน (รวมรายจ่ายประจำ)</p>
      <p v-if="paceNote" class="mb-3 text-sm">{{ paceNote }}</p>
      <LineChart :series="paceSeries" aria-label="รายจ่ายสะสมรายวัน เดือนนี้เทียบเดือนก่อน" />
    </section>

    <!-- Daily -->
    <section class="card mt-4 p-5">
      <h2 class="mb-1 text-[15px] font-semibold">รายจ่ายทั่วไปรายวัน</h2>
      <p class="mb-3 text-xs text-muted">ส่วนของเรา ไม่รวมรายจ่ายประจำ (ค่าผ่อน ค่าเช่า ฯลฯ) ใน{{ monthLabel }}</p>
      <p v-if="!variable.length" class="py-6 text-center text-sm text-muted">{{ pending ? 'กำลังโหลด…' : 'ไม่มีรายจ่ายทั่วไปในเดือนนี้' }}</p>
      <BarChart v-else :items="daily" :avg="avgPerDay" color="var(--s1)" aria-label="รายจ่ายรายวัน" />
    </section>

    <!-- Categories -->
    <div class="mt-4 grid items-start gap-4 xl:grid-cols-2">
      <section class="card p-5">
        <h2 class="mb-4 text-[15px] font-semibold">สัดส่วนตามหมวดหมู่</h2>
        <p v-if="!pie.length" class="py-6 text-center text-sm text-muted">ไม่มีรายจ่ายในเดือนนี้</p>
        <DonutChart v-else :items="pie" total-label="รายจ่ายรวม" />
      </section>

      <section class="card p-5">
        <h2 class="mb-1 text-[15px] font-semibold">เทียบกับเดือนก่อน</h2>
        <p class="mb-3 text-xs text-muted">แต่ละหมวด เดือนนี้เทียบเดือนก่อนหน้า<template v-if="isCurrentMonth"> (* เทียบเฉพาะวันที่ 1–{{ elapsedDays }} ของเดือนก่อน เพราะเดือนนี้ยังไม่จบ)</template></p>
        <div class="overflow-x-auto">
          <table v-if="categoryRows.length" class="w-full min-w-[280px] text-xs sm:text-[14px]">
            <thead class="text-left text-xs text-muted">
              <tr><th class="py-1.5 font-medium">หมวดหมู่</th><th class="py-1.5 text-right font-medium">เดือนนี้</th><th class="py-1.5 text-right font-medium">เดือนก่อน{{ isCurrentMonth ? '*' : '' }}</th><th class="py-1.5 text-right font-medium">เปลี่ยน</th></tr>
            </thead>
            <tbody class="divide-y divide-line">
              <tr v-for="c in categoryRows.slice(0, 10)" :key="c.key">
                <td class="max-w-[7rem] truncate py-2 sm:max-w-[9rem]">{{ c.name }}</td>
                <td class="num py-2 text-right">{{ formatMoney(c.cur) }}</td>
                <td class="num py-2 text-right text-muted">{{ formatMoney(c.prev) }}</td>
                <td class="num py-2 text-right text-xs" :class="changePct(c) === null || Math.abs(changePct(c)) < 0.5 ? 'text-muted' : changePct(c) > 0 ? 'text-expense' : 'text-income'">
                  {{ changePct(c) === null ? (c.cur > 0 ? 'ใหม่' : '—') : Math.abs(changePct(c)) < 0.5 ? '0%' : `${changePct(c) > 0 ? '+' : '−'}${Math.abs(changePct(c)).toFixed(0)}%` }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>

    <!-- Patterns + biggest items -->
    <div class="mt-4 grid items-start gap-4 xl:grid-cols-2">
      <section class="card space-y-6 p-5">
        <div>
          <h2 class="mb-3 text-[15px] font-semibold">ประจำ หรือ ทั่วไป</h2>
          <SplitBar :parts="fixedSplit" />
        </div>
        <div>
          <h2 class="mb-3 text-[15px] font-semibold">ส่วนตัว หรือ หารกับแฟน</h2>
          <SplitBar :parts="sharedSplit" />
        </div>
      </section>

      <section class="card p-5">
        <h2 class="mb-3 text-[15px] font-semibold">รายการที่ใช้มากที่สุด</h2>
        <p v-if="!topExpenses.length" class="py-6 text-center text-sm text-muted">ไม่มีรายจ่ายในเดือนนี้</p>
        <ol v-else class="divide-y divide-line">
          <li v-for="(t, i) in topExpenses" :key="i" class="flex items-center gap-3 py-2.5">
            <span class="num w-5 text-xs text-muted">{{ i + 1 }}</span>
            <div class="min-w-0 flex-1">
              <div class="truncate text-[14px]">{{ t.note || catName(t.category_id) }}</div>
              <div class="truncate text-xs text-muted">{{ catName(t.category_id) }} · {{ t.day }} {{ monthShort }}</div>
            </div>
            <div class="num text-[14px] font-medium">{{ formatMoney(t.share) }}</div>
          </li>
        </ol>
      </section>
    </div>

    <!-- Category trends -->
    <section v-if="trends.rows.length" class="card mt-4 p-5">
      <h2 class="mb-1 text-[15px] font-semibold">แนวโน้มรายหมวด 6 เดือน</h2>
      <p class="mb-2 text-xs text-muted">แท่งขวาสุดคือ{{ monthName(trendEndKey) }}<template v-if="isCurrentMonth"> (ไม่รวมเดือนนี้เพราะยังไม่จบ)</template> เปรียบเทียบกับค่าเฉลี่ยของ 5 เดือนก่อนหน้านั้น</p>
      <ul class="divide-y divide-line">
        <li v-for="t in trends.rows" :key="t.categoryId" class="flex items-center justify-between gap-4 py-2.5">
          <div class="min-w-0">
            <div class="truncate text-[14px]">{{ catName(t.categoryId === 'none' ? null : t.categoryId) }}</div>
            <div class="num text-xs text-muted">
              {{ formatMoney(t.last) }}
              <span v-if="t.vsAvg === null">· ไม่มีค่าเฉลี่ยก่อนหน้า</span>
              <span v-else-if="Math.abs(t.vsAvg) < 0.01">· ใกล้เคียงค่าเฉลี่ย</span>
              <span v-else :class="t.vsAvg > 0.1 ? 'text-expense' : t.vsAvg < -0.1 ? 'text-income' : ''">· {{ t.vsAvg >= 0 ? '+' : '−' }}{{ Math.abs(t.vsAvg * 100).toFixed(0) }}% จากค่าเฉลี่ย</span>
            </div>
          </div>
          <div class="flex h-10 shrink-0 items-end gap-1" role="img" :aria-label="`รายจ่าย ${catName(t.categoryId === 'none' ? null : t.categoryId)} 6 เดือน`">
            <span
              v-for="(v, i) in t.values" :key="i" class="w-3 rounded-t-sm"
              :title="`${monthName(trends.keys[i])}: ${formatMoney(v)}`"
              :style="{ height: Math.max(2, (v / trendMax(t)) * 40) + 'px', background: i === t.values.length - 1 ? 'var(--s1)' : 'rgb(var(--c-ink) / 0.25)' }"
            ></span>
          </div>
        </li>
      </ul>
    </section>

    <!-- Recurring costs + personal vs shared per month -->
    <div class="mt-4 grid items-start gap-4 xl:grid-cols-2">
      <section class="card p-5">
        <h2 class="mb-1 text-[15px] font-semibold">รายจ่ายที่เกิดซ้ำทุกเดือน</h2>
        <p class="mb-3 text-xs text-muted">รายการที่ชื่อ "ค่าอะไร" เหมือนกันอย่างน้อย 3 เดือนใน 12 เดือนล่าสุด</p>
        <p v-if="!recurring.length" class="py-4 text-center text-sm text-muted">ยังไม่พบ ยิ่งตั้งชื่อรายการให้ตรงกันทุกเดือน (เช่น "Netflix") ระบบยิ่งจับได้</p>
        <ul v-else class="divide-y divide-line">
          <li v-for="r in recurring" :key="r.label" class="flex items-center justify-between gap-3 py-2.5">
            <div class="min-w-0">
              <div class="truncate text-[14px]">{{ r.label }}</div>
              <div class="text-xs text-muted">{{ r.months }} เดือน · {{ r.steady ? 'ยอดคงที่' : 'ยอดผันแปร' }}<template v-if="r.fixed"> · ประจำ</template></div>
            </div>
            <div class="num shrink-0 text-[14px] font-medium">~{{ formatMoney(r.monthlyAvg) }}<span class="text-xs font-normal text-muted"> /เดือน</span></div>
          </li>
        </ul>
        <p v-if="recurring.length" class="num mt-3 border-t border-line pt-3 text-sm text-muted">รวมประมาณ {{ formatMoney(recurringMonthly) }} บาทต่อเดือน</p>
      </section>

      <section class="card p-5">
        <h2 class="mb-1 text-[15px] font-semibold">ส่วนตัว vs หารกับแฟน รายเดือน</h2>
        <p class="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
          <span class="flex items-center gap-1.5"><span class="h-2.5 w-2.5 rounded-full" style="background: var(--s1)"></span>ส่วนตัว</span>
          <span class="flex items-center gap-1.5"><span class="h-2.5 w-2.5 rounded-full" style="background: var(--s2)"></span>หารกัน (ส่วนของเรา)</span>
        </p>
        <ul class="space-y-3">
          <li v-for="m in splitMonths" :key="m.key" class="flex items-center gap-3 text-[13px]">
            <span class="w-9 shrink-0 text-muted">{{ monthName(m.key) }}<template v-if="isCurrentMonth && m.key === monthKey">*</template></span>
            <div class="flex h-2.5 min-w-0 flex-1 gap-0.5 overflow-hidden rounded-full bg-ink/5">
              <div :style="{ width: (m.personal / splitMax) * 100 + '%', background: 'var(--s1)' }" :title="`ส่วนตัว ${formatMoney(m.personal)}`"></div>
              <div :style="{ width: (m.shared / splitMax) * 100 + '%', background: 'var(--s2)' }" :title="`หารกัน ${formatMoney(m.shared)}`"></div>
            </div>
            <span class="num w-20 shrink-0 text-right">{{ formatMoney(m.personal + m.shared) }}</span>
          </li>
        </ul>
        <p v-if="isCurrentMonth" class="mt-3 text-xs text-muted">* เดือนนี้ยังไม่จบ</p>
      </section>
    </div>

    <!-- Trend + weekday -->
    <div class="mt-4 grid items-start gap-4 xl:grid-cols-2">
      <section class="card p-5">
        <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 class="text-[15px] font-semibold">รายรับ vs รายจ่าย</h2>
          <div class="segmented w-36 sm:w-44 grid-cols-2 text-xs sm:text-sm">
            <button :aria-pressed="span === 6" @click="span = 6">6 เดือน</button>
            <button :aria-pressed="span === 12" @click="span = 12">12 เดือน</button>
          </div>
        </div>
        <MonthlyChart :months="trend" />
      </section>

      <section class="card p-5">
        <h2 class="mb-1 text-[15px] font-semibold">ใช้จ่ายตามวันในสัปดาห์</h2>
        <p class="mb-3 text-xs text-muted">ยอดรวมของ{{ monthLabel }} ไม่รวมรายจ่ายประจำ</p>
        <p v-if="!variable.length" class="py-6 text-center text-sm text-muted">ไม่มีรายจ่ายในเดือนนี้</p>
        <BarChart v-else :items="weekday" color="var(--s2)" aria-label="รายจ่ายตามวันในสัปดาห์" />
      </section>
    </div>

    <!-- Help to set a budget / a goal from your own history -->
    <p v-if="actionMsg" class="mt-4 break-words rounded-lg bg-accent/10 px-4 py-3 text-sm">{{ actionMsg }}</p>
    <div class="mt-4 grid items-start gap-4 xl:grid-cols-2">
      <section class="card p-5">
        <h2 class="mb-1 text-[15px] font-semibold">แนะนำงบประมาณ</h2>
        <p class="mb-3 text-xs text-muted">คิดจากรายจ่ายเฉลี่ยของแต่ละหมวดใน 3 เดือนก่อนหน้า เผื่อ 10% สำหรับ{{ monthLabel }}</p>
        <p v-if="!budgetSuggestions.length" class="py-4 text-center text-sm text-muted">
          {{ profile ? 'หมวดที่มีรายจ่ายตั้งงบครบแล้ว' : 'ยังไม่มีข้อมูลย้อนหลังพอ ต้องมีรายจ่ายอย่างน้อย 1 เดือนก่อนหน้า' }}
        </p>
        <template v-else>
          <ul class="divide-y divide-line">
            <li v-for="s in budgetSuggestions" :key="s.categoryId" class="flex items-center justify-between gap-3 py-2.5">
              <div class="min-w-0">
                <div class="truncate text-[14px]">{{ catName(s.categoryId) }}</div>
                <div class="num text-xs text-muted">เฉลี่ย {{ formatMoney(s.avg) }}</div>
              </div>
              <div class="flex shrink-0 items-center gap-3">
                <span class="num text-[14px] font-medium">{{ formatMoney(s.suggested) }}</span>
                <button type="button" class="btn btn-quiet px-3 py-1 text-xs" :disabled="applying" @click="applyBudgets([s])">ตั้งงบ</button>
              </div>
            </li>
          </ul>
          <button v-if="budgetSuggestions.length > 1" type="button" class="btn btn-primary mt-4 w-full" :disabled="applying" @click="applyBudgets(budgetSuggestions)">
            ตั้งงบทั้ง {{ budgetSuggestions.length }} หมวด
          </button>
        </template>
      </section>

      <section class="card p-5">
        <h2 class="mb-1 text-[15px] font-semibold">ออมได้เท่าไหร่ และตั้งเป้าหมายอะไรดี</h2>
        <template v-if="profile">
          <p class="mb-3 text-xs text-muted">เฉลี่ย {{ profile.months }} เดือนก่อนหน้า</p>
          <dl class="num grid grid-cols-3 gap-3 text-sm">
            <div><dt class="text-xs text-muted">รายรับ</dt><dd class="font-semibold">{{ formatMoney(profile.avgIncome) }}</dd></div>
            <div><dt class="text-xs text-muted">รายจ่าย</dt><dd class="font-semibold">{{ formatMoney(profile.avgExpense) }}</dd></div>
            <div>
              <dt class="text-xs text-muted">เหลือออมได้</dt>
              <dd class="font-semibold" :class="profile.avgSavings < 0 ? 'text-expense' : ''">{{ formatMoney(profile.avgSavings) }}</dd>
            </div>
          </dl>
          <p v-if="profile.avgSavings <= 0" class="mt-3 text-sm text-muted">รายจ่ายเฉลี่ยไม่น้อยกว่ารายรับ ลองดูหมวดที่เพิ่มขึ้นในส่วน "แนวโน้มรายหมวด" ก่อนตั้งเป้าหมายออม</p>
          <ul class="mt-4 divide-y divide-line">
            <li v-for="plan in fundPlans" :key="plan.cover" class="flex items-center justify-between gap-3 py-3">
              <div class="min-w-0">
                <div class="text-[14px]">{{ goalName(plan) }}</div>
                <div class="num text-xs text-muted">
                  เป้าหมาย {{ formatMoney(plan.target) }}
                  <template v-if="plan.monthsToReach"> · ออมตามจังหวะนี้ราว {{ plan.monthsToReach }} เดือน<template v-if="plan.monthsToReach >= 12"> (≈ {{ (plan.monthsToReach / 12).toFixed(1) }} ปี)</template></template>
                </div>
              </div>
              <button v-if="!goalExists(plan)" type="button" class="btn btn-quiet shrink-0 px-3 py-1 text-xs" :disabled="applying" @click="createGoal(plan)">สร้างเป้าหมาย</button>
              <span v-else class="shrink-0 text-xs text-muted">มีแล้ว</span>
            </li>
          </ul>
          <p class="mt-3 text-xs text-muted">ประมาณการจากรายการที่บันทึกไว้ เกณฑ์เงินสำรอง 3-6 เดือนเป็นแนวทางทั่วไป ไม่ใช่คำแนะนำทางการเงินเฉพาะบุคคล</p>
        </template>
        <p v-else class="py-4 text-center text-sm text-muted">ยังไม่มีข้อมูลย้อนหลังพอ ต้องมีรายการอย่างน้อย 1 เดือนก่อนหน้า</p>
      </section>
    </div>

    <!-- Budget vs actual -->
    <section v-if="data.budgets.length" class="card mt-4 p-5">
      <div class="mb-3 flex items-baseline justify-between">
        <h2 class="text-[15px] font-semibold">งบ vs ใช้จริง</h2>
        <NuxtLink to="/budgets" class="text-xs text-accent">จัดการงบ</NuxtLink>
      </div>
      <ul class="space-y-4">
        <li v-for="b in data.budgets" :key="b.category_name">
          <div class="flex items-baseline justify-between gap-4 text-[14px]">
            <span class="truncate">{{ b.category_name }}</span>
            <span class="num shrink-0 text-xs text-muted">{{ formatMoney(b.spent) }} / {{ formatMoney(b.amount_limit) }} · {{ b.percent_used.toFixed(0) }}%</span>
          </div>
          <div class="mt-1.5 h-2 overflow-hidden rounded-full bg-ink/10">
            <div class="h-full rounded-full" :class="barColor(b.percent_used)" :style="{ width: Math.min(b.percent_used, 100) + '%' }"></div>
          </div>
        </li>
      </ul>
    </section>
  </div>
</template>
