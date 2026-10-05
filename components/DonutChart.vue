<script setup>
// Donut with a legend that doubles as the table view. Colours: fixed series order --s1..--s8.
const props = defineProps({
  items: { type: Array, required: true }, // [{ key, label, value }]
  totalLabel: { type: String, default: 'รวม' },
});

const SIZE = 200;
const R = 74;
const STROKE = 26;
const C = 2 * Math.PI * R;
const GAP = 2; // surface-colour gap between segments

const total = computed(() => props.items.reduce((s, i) => s + i.value, 0));
const active = ref(null);

const segments = computed(() => {
  let offset = 0;
  return props.items.map((item, i) => {
    const len = total.value ? (item.value / total.value) * C : 0;
    const seg = {
      ...item, i,
      color: `var(--s${(i % 8) + 1})`,
      pct: total.value ? (item.value / total.value) * 100 : 0,
      dash: props.items.length === 1 ? `${C} 0` : `${Math.max(len - GAP, 0.5)} ${C}`,
      offset: -offset,
    };
    offset += len;
    return seg;
  });
});

const shown = computed(() => segments.value[active.value] ?? null);
const toggle = (i) => { active.value = active.value === i ? null : i; };
</script>

<template>
  <div class="flex flex-col items-center gap-6 sm:flex-row sm:items-center">
    <div class="relative shrink-0" :style="{ width: SIZE + 'px', height: SIZE + 'px' }">
      <svg :viewBox="`0 0 ${SIZE} ${SIZE}`" :width="SIZE" :height="SIZE" role="img" :aria-label="`สัดส่วน ${items.length} หมวดหมู่`" @mouseleave="active = null">
        <circle :cx="SIZE / 2" :cy="SIZE / 2" :r="R" fill="none" stroke="rgb(var(--c-ink) / 0.08)" :stroke-width="STROKE" />
        <g :transform="`rotate(-90 ${SIZE / 2} ${SIZE / 2})`">
          <circle
            v-for="s in segments" :key="s.key"
            :cx="SIZE / 2" :cy="SIZE / 2" :r="R" fill="none"
            :stroke="s.color" :stroke-width="active === s.i ? STROKE + 4 : STROKE"
            :stroke-dasharray="s.dash" :stroke-dashoffset="s.offset"
            :opacity="active === null || active === s.i ? 1 : 0.35"
            class="cursor-pointer transition-all"
            @mouseenter="active = s.i" @click="toggle(s.i)"
          />
        </g>
      </svg>
      <div class="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-9 text-center">
        <template v-if="shown">
          <div class="max-w-full truncate text-xs text-muted">{{ shown.label }}</div>
          <div class="num text-lg font-semibold leading-tight">{{ formatMoney(shown.value) }}</div>
          <div class="num text-xs text-muted">{{ shown.pct.toFixed(1) }}%</div>
        </template>
        <template v-else>
          <div class="text-xs text-muted">{{ totalLabel }}</div>
          <div class="num text-lg font-semibold leading-tight">{{ formatMoney(total) }}</div>
        </template>
      </div>
    </div>

    <ul class="w-full min-w-0 flex-1 divide-y divide-line">
      <li
        v-for="s in segments" :key="s.key"
        class="flex cursor-pointer items-center gap-3 py-2 transition-opacity"
        :class="active !== null && active !== s.i ? 'opacity-50' : ''"
        @mouseenter="active = s.i" @mouseleave="active = null" @click="toggle(s.i)"
      >
        <span class="h-2.5 w-2.5 shrink-0 rounded-full" :style="{ background: s.color }"></span>
        <span class="min-w-0 flex-1 truncate text-[14px]">{{ s.label }}</span>
        <span class="num text-[14px]">{{ formatMoney(s.value) }}</span>
        <span class="num w-12 text-right text-xs text-muted">{{ s.pct.toFixed(1) }}%</span>
      </li>
    </ul>
  </div>
</template>
