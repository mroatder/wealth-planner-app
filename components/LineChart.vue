<script setup>
// Running-total lines over the days of a month (spending pace). Hand-drawn SVG sized to its container.
const props = defineProps({
  series: { type: Array, required: true }, // [{ key, label, color, values: (number|null)[] }]  index 0 = day 1
  height: { type: Number, default: 220 },
  ariaLabel: { type: String, default: 'กราฟเส้น' },
});

const box = ref(null);
const width = ref(300);
const hover = ref(null);

onMounted(() => {
  if (!box.value) return;
  width.value = box.value.clientWidth || 300;
  const ro = new ResizeObserver(([e]) => { width.value = Math.max(e.contentRect.width, 240); });
  ro.observe(box.value);
  onBeforeUnmount(() => ro.disconnect());
});

const M = { top: 12, right: 12, bottom: 26, left: 44 };
const n = computed(() => Math.max(1, ...props.series.map((s) => s.values.length)));
const plotW = computed(() => width.value - M.left - M.right);
const plotH = computed(() => props.height - M.top - M.bottom);

const axis = computed(() => niceAxis(Math.max(0, ...props.series.flatMap((s) => s.values.filter((v) => v !== null)))));
const ticks = computed(() => Array.from({ length: axis.value.n + 1 }, (_, i) => axis.value.step * i));
const x = (i) => M.left + (n.value === 1 ? plotW.value / 2 : (i / (n.value - 1)) * plotW.value);
const y = (v) => M.top + plotH.value - (v / axis.value.max) * plotH.value;
const labelEvery = computed(() => Math.ceil(n.value / Math.max(1, Math.floor(plotW.value / 30))));

// one path per series; a gap (null) ends the line
const lines = computed(() => props.series.map((s) => {
  let d = '';
  let pen = false;
  let last = null;
  s.values.forEach((v, i) => {
    if (v === null || v === undefined) { pen = false; return; }
    d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)} `;
    pen = true;
    last = { i, v };
  });
  return { ...s, d, last };
}));

const tip = computed(() => {
  const i = hover.value;
  if (i === null) return null;
  const left = x(i) + 8 + 150 <= width.value ? x(i) + 8 : Math.max(x(i) - 158, 0);
  return { i, left, rows: props.series.map((s) => ({ label: s.label, color: s.color, value: s.values[i] ?? null })) };
});

function onMove(e) {
  const r = e.currentTarget.getBoundingClientRect();
  const px = (e.touches?.[0]?.clientX ?? e.clientX) - r.left;
  hover.value = Math.min(n.value - 1, Math.max(0, Math.round(((px - M.left) / plotW.value) * (n.value - 1))));
}
</script>

<template>
  <div>
    <div class="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
      <span v-for="s in series" :key="s.key" class="flex items-center gap-1.5">
        <span class="h-0.5 w-4 rounded-full" :style="{ background: s.color }"></span>{{ s.label }}
      </span>
    </div>

    <div ref="box" class="relative w-full min-w-0 overflow-hidden" @mouseleave="hover = null">
      <svg :width="width" :height="height" class="block" role="img" :aria-label="ariaLabel">
        <line v-for="t in ticks" :key="t" :x1="M.left" :x2="width - M.right" :y1="y(t)" :y2="y(t)" class="stroke-line" stroke-width="1" />
        <text v-for="t in ticks" :key="'l' + t" :x="M.left - 8" :y="y(t) + 4" text-anchor="end" class="num fill-muted" font-size="11">{{ tickLabel(t) }}</text>
        <template v-for="i in n" :key="'x' + i">
          <text v-if="(i - 1) % labelEvery === 0" :x="x(i - 1)" :y="height - 8" text-anchor="middle" class="fill-muted" font-size="11">{{ i }}</text>
        </template>

        <line v-if="hover !== null" :x1="x(hover)" :x2="x(hover)" :y1="M.top" :y2="M.top + plotH" class="stroke-line" stroke-width="1" />

        <g v-for="l in lines" :key="l.key">
          <path :d="l.d" fill="none" :stroke="l.color" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
          <template v-if="l.last">
            <circle :cx="x(l.last.i)" :cy="y(l.last.v)" r="6" class="fill-surface" />
            <circle :cx="x(l.last.i)" :cy="y(l.last.v)" r="4" :fill="l.color" />
          </template>
        </g>

        <rect :x="M.left" :y="M.top" :width="plotW" :height="plotH + M.bottom" fill="transparent" @mousemove="onMove" @touchstart.passive="onMove" @touchmove.passive="onMove" />
      </svg>

      <div v-if="tip" class="pointer-events-none absolute top-0 z-10 w-36 rounded-lg bg-surface px-3 py-2 text-xs shadow-card ring-1 ring-line" :style="{ left: tip.left + 'px' }">
        <div class="mb-1 font-semibold">วันที่ {{ tip.i + 1 }}</div>
        <div v-for="r in tip.rows" :key="r.label" class="flex items-center justify-between gap-2">
          <span class="flex items-center gap-1.5 text-muted"><span class="h-2 w-2 rounded-full" :style="{ background: r.color }"></span>{{ r.label }}</span>
          <span class="num">{{ r.value === null ? '—' : formatMoney(r.value) }}</span>
        </div>
      </div>
    </div>
  </div>
</template>
