<script setup>
// Grouped columns: income vs expense per month. Hand-drawn SVG sized to its container.
const props = defineProps({
  months: { type: Array, required: true }, // [{ key, label, income, expense }]
});

const box = ref(null);
const width = ref(300);
const hover = ref(null);
const showTable = ref(false);

onMounted(() => {
  if (!box.value) return;
  width.value = box.value.clientWidth || 640;
  const ro = new ResizeObserver(([e]) => { width.value = Math.max(e.contentRect.width, 280); });
  ro.observe(box.value);
  onBeforeUnmount(() => ro.disconnect());
});

const H = 240;
const M = { top: 12, right: 8, bottom: 28, left: 44 };
const plotW = computed(() => width.value - M.left - M.right);
const plotH = H - M.top - M.bottom;

const axis = computed(() => niceAxis(Math.max(1, ...props.months.flatMap((m) => [m.income, m.expense]))));
const yMax = computed(() => axis.value.max);
const ticks = computed(() => Array.from({ length: axis.value.n + 1 }, (_, i) => axis.value.step * i));
const y = (v) => M.top + plotH - (v / yMax.value) * plotH;

const slot = computed(() => plotW.value / Math.max(props.months.length, 1));
const barW = computed(() => Math.min(24, slot.value * 0.3));
const GAP = 2;
// skip month labels when there is no room for all of them (narrow screens, 12-month view)
const labelEvery = computed(() => Math.ceil(props.months.length / Math.max(1, Math.floor(plotW.value / 36))));

const bar = (x, value, w) => columnPath(x, y(value), M.top + plotH, w);

const groups = computed(() => props.months.map((m, i) => {
  const cx = M.left + slot.value * (i + 0.5);
  return { ...m, i, cx, incomeX: cx - GAP / 2 - barW.value, expenseX: cx + GAP / 2 };
}));

const tip = computed(() => {
  const g = groups.value[hover.value];
  if (!g) return null;
  const right = g.cx + slot.value / 2 + 4;
  const left = right + 160 <= width.value ? right : Math.max(g.cx - slot.value / 2 - 164, 0);
  return { ...g, left: Math.max(4, Math.min(left, width.value - 170)) };
});
</script>

<template>
  <div>
    <div class="mb-3 flex items-center gap-4 text-xs text-muted">
      <span class="flex items-center gap-1.5"><span class="h-2.5 w-2.5 rounded-sm" style="background: var(--s1)"></span>รายรับ</span>
      <span class="flex items-center gap-1.5"><span class="h-2.5 w-2.5 rounded-sm" style="background: var(--s2)"></span>รายจ่าย (ส่วนของเรา)</span>
    </div>

    <div ref="box" class="relative w-full min-w-0 overflow-hidden" @mouseleave="hover = null">
      <svg :width="width" :height="H" class="block" role="img" aria-label="รายรับเทียบรายจ่ายรายเดือน">
        <g>
          <line v-for="t in ticks" :key="t" :x1="M.left" :x2="width - M.right" :y1="y(t)" :y2="y(t)" class="stroke-line" stroke-width="1" />
          <text v-for="t in ticks" :key="'l' + t" :x="M.left - 8" :y="y(t) + 4" text-anchor="end" class="num fill-muted" font-size="11">{{ tickLabel(t) }}</text>
        </g>

        <rect v-if="hover !== null" :x="M.left + slot * hover" :y="M.top" :width="slot" :height="plotH" class="fill-ink" fill-opacity="0.05" />

        <g v-for="g in groups" :key="g.key">
          <path :d="bar(g.incomeX, g.income, barW)" fill="var(--s1)" />
          <path :d="bar(g.expenseX, g.expense, barW)" fill="var(--s2)" />
          <text v-show="g.i % labelEvery === 0" :x="g.cx" :y="H - 8" text-anchor="middle" class="fill-muted" font-size="11">{{ g.label }}</text>
        </g>

        <!-- hover targets: full-height column per month -->
        <rect
          v-for="g in groups" :key="'h' + g.key"
          :x="M.left + slot * g.i" :y="M.top" :width="slot" :height="plotH + M.bottom" fill="transparent"
          @mouseenter="hover = g.i" @mousemove="hover = g.i" @click="hover = g.i"
        />
      </svg>

      <div
        v-if="tip"
        class="pointer-events-none absolute top-0 z-10 w-40 rounded-lg bg-surface px-3 py-2 text-xs shadow-card ring-1 ring-line"
        :style="{ left: tip.left + 'px' }"
      >
        <div class="mb-1 font-semibold">{{ tip.label }}</div>
        <div class="flex justify-between"><span class="text-muted">รายรับ</span><span class="num">{{ formatMoney(tip.income) }}</span></div>
        <div class="flex justify-between"><span class="text-muted">รายจ่าย</span><span class="num">{{ formatMoney(tip.expense) }}</span></div>
        <div class="mt-1 flex justify-between border-t border-line pt-1">
          <span class="text-muted">คงเหลือ</span><span class="num" :class="tip.income - tip.expense < 0 ? 'text-expense' : ''">{{ formatMoney(tip.income - tip.expense) }}</span>
        </div>
      </div>
    </div>

    <button class="mt-2 text-xs text-accent" @click="showTable = !showTable">{{ showTable ? 'ซ่อนตาราง' : 'ดูเป็นตาราง' }}</button>
    <table v-if="showTable" class="mt-2 w-full text-sm">
      <thead class="text-left text-xs text-muted">
        <tr><th class="py-1 font-medium">เดือน</th><th class="py-1 text-right font-medium">รายรับ</th><th class="py-1 text-right font-medium">รายจ่าย</th><th class="py-1 text-right font-medium">คงเหลือ</th></tr>
      </thead>
      <tbody class="divide-y divide-line">
        <tr v-for="m in months" :key="m.key">
          <td class="py-1.5">{{ m.label }}</td>
          <td class="num py-1.5 text-right">{{ formatMoney(m.income) }}</td>
          <td class="num py-1.5 text-right">{{ formatMoney(m.expense) }}</td>
          <td class="num py-1.5 text-right" :class="m.income - m.expense < 0 ? 'text-expense' : ''">{{ formatMoney(m.income - m.expense) }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
