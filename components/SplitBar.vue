<script setup>
// One stacked bar split into parts, with a legend that carries the exact numbers.
const props = defineProps({
  parts: { type: Array, required: true }, // [{ label, value, color }]
});
const total = computed(() => props.parts.reduce((s, p) => s + p.value, 0));
const pct = (v) => (total.value ? (v / total.value) * 100 : 0);
</script>

<template>
  <div>
    <div v-if="total > 0" class="flex h-3 gap-0.5 overflow-hidden rounded-full" role="img" :aria-label="parts.map((p) => `${p.label} ${pct(p.value).toFixed(0)}%`).join(' ')">
      <div v-for="p in parts.filter((x) => x.value > 0)" :key="p.label" :style="{ width: pct(p.value) + '%', background: p.color }"></div>
    </div>
    <div v-else class="h-3 rounded-full bg-ink/10"></div>

    <ul class="mt-3 space-y-1.5">
      <li v-for="p in parts" :key="p.label" class="flex items-center gap-2.5 text-[14px]">
        <span class="h-2.5 w-2.5 shrink-0 rounded-full" :style="{ background: p.color }"></span>
        <span class="flex-1">{{ p.label }}</span>
        <span class="num">{{ formatMoney(p.value) }}</span>
        <span class="num w-12 text-right text-xs text-muted">{{ pct(p.value).toFixed(0) }}%</span>
      </li>
    </ul>
  </div>
</template>
