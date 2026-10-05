<script setup>
// Single-series columns (daily spend, weekday pattern...). Hand-drawn SVG sized to its container.
const props = defineProps({
  items: { type: Array, required: true }, // [{ key, label, value, tip? }]
  color: { type: String, default: 'var(--s1)' },
  avg: { type: Number, default: null },    // optional reference line
  height: { type: Number, default: 200 },
  ariaLabel: { type: String, default: 'กราฟแท่ง' },
});

const box = ref(null);
const width = ref(300);
const hover = ref(null);

onMounted(() => {
  if (!box.value) return;
  width.value = box.value.clientWidth || 640;
  const ro = new ResizeObserver(([e]) => { width.value = Math.max(e.contentRect.width, 240); });
  ro.observe(box.value);
  onBeforeUnmount(() => ro.disconnect());
});

const M = { top: 10, right: 8, bottom: 26, left: 44 };
const plotW = computed(() => width.value - M.left - M.right);
const plotH = computed(() => props.height - M.top - M.bottom);

const axis = computed(() => niceAxis(Math.max(0, ...props.items.map((i) => i.value), props.avg ?? 0)));
const ticks = computed(() => Array.from({ length: axis.value.n + 1 }, (_, i) => axis.value.step * i));
const y = (v) => M.top + plotH.value - (v / axis.value.max) * plotH.value;

const slot = computed(() => plotW.value / Math.max(props.items.length, 1));
const barW = computed(() => Math.min(24, Math.max(slot.value * 0.7, 3)));
const labelEvery = computed(() => Math.ceil(props.items.length / Math.max(1, Math.floor(plotW.value / 34))));

const bars = computed(() => props.items.map((it, i) => {
  const cx = M.left + slot.value * (i + 0.5);
  return { ...it, i, cx, d: columnPath(cx - barW.value / 2, y(it.value), M.top + plotH.value, barW.value) };
}));

const tip = computed(() => {
  const b = bars.value[hover.value];
  if (!b) return null;
  const right = b.cx + slot.value / 2 + 4;
  const left = right + 140 <= width.value ? right : Math.max(b.cx - slot.value / 2 - 144, 0);
  return { ...b, left: Math.max(4, Math.min(left, width.value - 150)) };
});
</script>

<template>
  <div ref="box" class="relative w-full min-w-0 overflow-hidden" @mouseleave="hover = null">
    <svg :width="width" :height="height" class="block" role="img" :aria-label="ariaLabel">
      <line v-for="t in ticks" :key="t" :x1="M.left" :x2="width - M.right" :y1="y(t)" :y2="y(t)" class="stroke-line" stroke-width="1" />
      <text v-for="t in ticks" :key="'l' + t" :x="M.left - 8" :y="y(t) + 4" text-anchor="end" class="num fill-muted" font-size="11">{{ tickLabel(t) }}</text>

      <rect v-if="hover !== null" :x="M.left + slot * hover" :y="M.top" :width="slot" :height="plotH" class="fill-ink" fill-opacity="0.05" />

      <path v-for="b in bars" :key="b.key" :d="b.d" :fill="color" />

      <template v-if="avg !== null && avg > 0">
        <line :x1="M.left" :x2="width - M.right" :y1="y(avg)" :y2="y(avg)" class="stroke-muted" stroke-width="1" />
        <text :x="width - M.right" :y="y(avg) - 4" text-anchor="end" class="num fill-muted" font-size="11">เฉลี่ย {{ formatMoney(avg) }}</text>
      </template>

      <text
        v-for="b in bars" v-show="b.i % labelEvery === 0" :key="'x' + b.key"
        :x="b.cx" :y="height - 8" text-anchor="middle" class="fill-muted" font-size="11"
      >{{ b.label }}</text>

      <rect
        v-for="b in bars" :key="'h' + b.key"
        :x="M.left + slot * b.i" :y="M.top" :width="slot" :height="plotH + M.bottom" fill="transparent"
        @mouseenter="hover = b.i" @mousemove="hover = b.i" @click="hover = b.i"
      />
    </svg>

    <div
      v-if="tip"
      class="pointer-events-none absolute top-0 z-10 w-36 rounded-lg bg-surface px-3 py-2 text-xs shadow-card ring-1 ring-line"
      :style="{ left: tip.left + 'px' }"
    >
      <div class="font-semibold">{{ tip.tip || tip.label }}</div>
      <div class="num">{{ formatMoney(tip.value) }}</div>
    </div>
  </div>
</template>
