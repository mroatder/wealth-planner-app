<script setup>
// iOS-style switch with a label on the left
defineProps({ modelValue: Boolean, label: String, hint: String });
defineEmits(['update:modelValue']);
</script>

<template>
  <div class="flex items-center justify-between gap-4">
    <div>
      <div class="text-[15px]">{{ label }}</div>
      <div v-if="hint" class="text-xs text-muted">{{ hint }}</div>
    </div>
    <button
      type="button" role="switch" :aria-checked="modelValue" :aria-label="label"
      class="relative h-[26px] w-[44px] shrink-0 rounded-full transition-colors"
      :class="modelValue ? 'bg-income' : 'bg-ink/20'"
      @click="$emit('update:modelValue', !modelValue)"
    >
      <span
        class="absolute left-0.5 top-0.5 h-[22px] w-[22px] rounded-full bg-white shadow transition-transform"
        :class="modelValue ? 'translate-x-[18px]' : ''"
      ></span>
    </button>
  </div>
</template>
