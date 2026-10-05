<script setup>
const props = defineProps({
  modelValue: { type: String, default: '' },
  id: { type: String, default: '' },
});

const emit = defineEmits(['update:modelValue']);

const pad = (n) => String(n).padStart(2, '0');

const datePart = ref('');
const hourPart = ref('12');
const minutePart = ref('00');

function parseValue(val) {
  if (!val) {
    const now = new Date();
    datePart.value = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    hourPart.value = pad(now.getHours());
    minutePart.value = pad(now.getMinutes());
    return;
  }
  const [d, t] = val.split('T');
  if (d) datePart.value = d;
  if (t) {
    const [h, m] = t.split(':');
    if (h !== undefined) hourPart.value = pad(Number(h) || 0);
    if (m !== undefined) minutePart.value = pad(Number(m) || 0);
  }
}

watch(() => props.modelValue, (val) => {
  parseValue(val);
}, { immediate: true });

function update() {
  if (!datePart.value) return;
  const newValue = `${datePart.value}T${hourPart.value}:${minutePart.value}`;
  emit('update:modelValue', newValue);
}

watch([datePart, hourPart, minutePart], () => {
  update();
});

function setNow() {
  const now = new Date();
  datePart.value = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  hourPart.value = pad(now.getHours());
  minutePart.value = pad(now.getMinutes());
  update();
}
</script>

<template>
  <div class="flex flex-wrap items-center gap-2">
    <!-- Date -->
    <input
      :id="id"
      v-model="datePart"
      type="date"
      class="field w-auto flex-1 min-w-[140px]"
    />

    <!-- 24-Hour Time (Hour:Minute + Now button) -->
    <div class="flex items-center gap-1.5 shrink-0">
      <div class="flex items-center gap-1 rounded-lg border border-line bg-surface px-2.5 py-1.5">
        <select
          v-model="hourPart"
          class="bg-transparent num font-semibold text-center focus:outline-none cursor-pointer text-sm"
          aria-label="ชั่วโมง (00-23)"
        >
          <option v-for="h in 24" :key="h - 1" :value="pad(h - 1)">
            {{ pad(h - 1) }}
          </option>
        </select>
        <span class="font-bold text-muted text-xs">:</span>
        <select
          v-model="minutePart"
          class="bg-transparent num font-semibold text-center focus:outline-none cursor-pointer text-sm"
          aria-label="นาที (00-59)"
        >
          <option v-for="m in 60" :key="m - 1" :value="pad(m - 1)">
            {{ pad(m - 1) }}
          </option>
        </select>
        <span class="text-xs text-muted font-medium pl-0.5">น.</span>
      </div>

      <button
        type="button"
        class="btn btn-quiet text-xs px-2.5 py-2 font-medium"
        title="ตั้งเป็นเวลาปัจจุบัน"
        @click="setNow"
      >
        ตอนนี้
      </button>
    </div>
  </div>
</template>
