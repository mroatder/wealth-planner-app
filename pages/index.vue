<script setup>
const supabase = useSupabaseClient();

const now = new Date();
const pad = (n) => String(n).padStart(2, '0');
const monthStart = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`;
const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
const monthEnd = `${next.getFullYear()}-${pad(next.getMonth() + 1)}-01`;
const monthLabel = now.toLocaleDateString('th-TH', { month: 'long', year: 'numeric' });

const { data, loaded } = useLoad('overview', async () => {
  const from = new Date(`${monthStart}T00:00:00+07:00`).toISOString();
  const to = new Date(`${monthEnd}T00:00:00+07:00`).toISOString();
  const [net, tx, budgets, goals, partner] = await Promise.all([
    supabase.from('net_worth').select('net_worth').maybeSingle(),
    supabase.from('transactions').select('type,amount,owed_amount')
      .in('type', ['income', 'expense']).gte('occurred_at', from).lt('occurred_at', to).limit(5000),
    supabase.from('budget_progress').select('id,category_name,amount_limit,spent,percent_used')
      .eq('month', monthStart).order('percent_used', { ascending: false }).limit(4),
    supabase.from('goal_progress').select('goal_id,name,target_amount,saved,percent').eq('status', 'active').order('percent', { ascending: false }).limit(3),
    supabase.from('partner_balance').select('owed_to_me').maybeSingle(),
  ]);
  for (const r of [net, tx, budgets, goals]) if (r.error) throw r.error;
  let income = 0;
  let expense = 0;
  for (const t of tx.data) {
    if (t.type === 'income') income += Number(t.amount);
    else expense += Number(t.amount) - Number(t.owed_amount);
  }
  return {
    netWorth: Number(net.data?.net_worth ?? 0),
    income, expense,
    budgets: budgets.data.map((b) => ({ ...b, spent: Number(b.spent), amount_limit: Number(b.amount_limit), percent_used: Number(b.percent_used) })),
    goals: goals.data.map((g) => ({ ...g, saved: Number(g.saved), target_amount: Number(g.target_amount), percent: Number(g.percent) })),
    owed: Number(partner.data?.owed_to_me ?? 0),
  };
}, {
  default: () => ({ netWorth: 0, income: 0, expense: 0, budgets: [], goals: [], owed: 0 }),
});

const net = computed(() => data.value.income - data.value.expense);
const barColor = (p) => (p >= 100 ? 'bg-expense' : p >= 80 ? 'bg-warn' : 'bg-accent');
</script>

<template>
  <div :class="loaded ? '' : 'opacity-60 transition-opacity'">
    <h1 class="title">ภาพรวม</h1>

    <section class="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
    <div class="card px-5 py-4 sm:col-span-2 lg:col-span-1">
      <div class="text-[13px] font-medium text-muted">Net Worth</div>
      <div class="num mt-1 text-[28px] font-bold leading-tight tracking-tight" :class="data.netWorth < 0 ? 'text-expense' : ''">
        {{ formatMoney(data.netWorth) }}
      </div>
      <NuxtLink to="/wallets" class="mt-0.5 inline-block text-xs text-accent">ดูกระเป๋า</NuxtLink>
    </div>
      <div class="card px-5 py-4">
        <div class="text-[13px] font-medium text-muted">รายรับ · {{ monthLabel }}</div>
        <div class="num mt-1 text-[20px] font-bold tracking-tight">{{ formatMoney(data.income) }}</div>
      </div>
      <div class="card px-5 py-4">
        <div class="text-[13px] font-medium text-muted">รายจ่าย (ส่วนของเรา)</div>
        <div class="num mt-1 text-[20px] font-bold tracking-tight">{{ formatMoney(data.expense) }}</div>
      </div>
      <div class="card px-5 py-4">
        <div class="text-[13px] font-medium text-muted">คงเหลือ</div>
        <div class="num mt-1 text-[20px] font-bold tracking-tight" :class="net < 0 ? 'text-expense' : ''">{{ formatMoney(net) }}</div>
      </div>
    </section>

    <NuxtLink v-if="data.owed !== 0" to="/partner" class="card mt-3 flex items-center justify-between px-5 py-3 text-sm">
      <span class="text-muted">{{ data.owed > 0 ? 'แฟนต้องจ่ายคืนเรา' : 'เราต้องจ่ายคืนแฟน' }}</span>
      <span class="num font-medium" :class="data.owed < 0 ? 'text-expense' : ''">{{ formatMoney(Math.abs(data.owed)) }}</span>
    </NuxtLink>

    <div class="mt-8 grid items-start gap-8 lg:grid-cols-2">
      <section>
        <div class="mb-2 flex items-baseline justify-between">
          <h2 class="section-label">งบประมาณ</h2>
          <NuxtLink to="/budgets" class="text-xs text-accent">ทั้งหมด</NuxtLink>
        </div>
        <p v-if="!data.budgets.length" class="card px-4 py-4 text-sm text-muted">{{ loaded ? 'ยังไม่ได้ตั้งงบเดือนนี้' : 'กำลังโหลด…' }}</p>
        <ul v-else class="card divide-y divide-line overflow-hidden">
          <li v-for="b in data.budgets" :key="b.id" class="px-4 py-3">
            <div class="flex items-baseline justify-between gap-4">
              <div class="truncate text-[15px]">{{ b.category_name }}</div>
              <div class="num shrink-0 text-xs text-muted">{{ formatMoney(b.spent) }} / {{ formatMoney(b.amount_limit) }}</div>
            </div>
            <div class="mt-2 h-2 overflow-hidden rounded-full bg-ink/10">
              <div class="h-full rounded-full" :class="barColor(b.percent_used)" :style="{ width: Math.min(b.percent_used, 100) + '%' }"></div>
            </div>
          </li>
        </ul>
      </section>

      <section>
        <div class="mb-2 flex items-baseline justify-between">
          <h2 class="section-label">เป้าหมาย</h2>
          <NuxtLink to="/goals" class="text-xs text-accent">ทั้งหมด</NuxtLink>
        </div>
        <p v-if="!data.goals.length" class="card px-4 py-4 text-sm text-muted">{{ loaded ? 'ยังไม่มีเป้าหมายที่กำลังออม' : 'กำลังโหลด…' }}</p>
        <ul v-else class="card divide-y divide-line overflow-hidden">
          <li v-for="g in data.goals" :key="g.goal_id" class="px-4 py-3">
            <div class="flex items-baseline justify-between gap-4">
              <div class="truncate text-[15px]">{{ g.name }}</div>
              <div class="num shrink-0 text-xs text-muted">{{ g.percent.toFixed(0) }}%</div>
            </div>
            <div class="mt-2 h-2 overflow-hidden rounded-full bg-ink/10">
              <div class="h-full rounded-full bg-accent" :style="{ width: g.percent + '%' }"></div>
            </div>
            <div class="num mt-1.5 text-xs text-muted">{{ formatMoney(g.saved) }} / {{ formatMoney(g.target_amount) }}</div>
          </li>
        </ul>
      </section>
    </div>

    <div class="mt-8 flex flex-col gap-3 sm:flex-row">
      <NuxtLink to="/transactions" class="btn btn-primary">บันทึกรายการ</NuxtLink>
      <NuxtLink to="/transactions#slip" class="btn btn-quiet">แนบสลิปธนาคาร</NuxtLink>
      <NuxtLink to="/history" class="btn btn-quiet">ดูประวัติ</NuxtLink>
    </div>
  </div>
</template>
