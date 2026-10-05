<script setup>
// Compact month switcher: ‹  [ ต.ค. 2569 ▾ ]  ›   (+ a small "เดือนนี้" shortcut while viewing another month)
// v-model is a Date set to the 1st of the month.
const model = defineModel({ type: Date, required: true });

const now = new Date();
const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
const index = (d) => d.getFullYear() * 12 + d.getMonth(); // month counter, handy for ranges and sorting

// last 3 years up to 3 months ahead, widened if the current value is outside that; newest first
const options = computed(() => {
  const from = Math.min(index(thisMonth) - 35, index(model.value));
  const to = Math.max(index(thisMonth) + 3, index(model.value));
  return Array.from({ length: to - from + 1 }, (_, i) => {
    const k = to - i;
    return { value: k, label: new Date(Math.floor(k / 12), k % 12, 1).toLocaleDateString('th-TH', { month: 'short', year: 'numeric' }) };
  });
});

const selected = computed({
  get: () => index(model.value),
  set: (k) => { model.value = new Date(Math.floor(Number(k) / 12), Number(k) % 12, 1); },
});
const isCurrent = computed(() => model.value.getTime() === thisMonth.getTime());
const shift = (n) => { model.value = new Date(model.value.getFullYear(), model.value.getMonth() + n, 1); };
</script>

<template>
  <div class="flex items-center justify-between gap-2">
    <button type="button" class="btn btn-quiet px-3" aria-label="เดือนก่อน" @click="shift(-1)">‹</button>

    <div class="flex min-w-0 flex-1 items-center justify-center gap-3">
      <select v-model="selected" class="field w-auto cursor-pointer py-1.5 text-[15px] font-semibold" aria-label="เลือกเดือนและปี">
        <option v-for="o in options" :key="o.value" :value="o.value">{{ o.label }}</option>
      </select>
      <button v-if="!isCurrent" type="button" class="shrink-0 text-xs text-accent" @click="model = thisMonth">เดือนนี้</button>
    </div>

    <button type="button" class="btn btn-quiet px-3" aria-label="เดือนถัดไป" @click="shift(1)">›</button>
  </div>
</template>
