<script setup>
import Sparkline from './Sparkline.vue'

defineProps({
  label: { type: String, default: '' },
  value: { type: String, default: '—' },
  unit: { type: String, default: '' },
  hint: { type: String, default: '' },
  data: { type: Array, default: () => [] },
  tone: { type: String, default: 'default' }
})
</script>

<template>
  <div class="card card-hover relative overflow-hidden p-4">
    <div class="flex items-start justify-between">
      <p class="micro">{{ label }}</p>
      <slot name="icon" />
    </div>
    <div class="mt-3 flex items-baseline gap-1.5">
      <span class="num text-[26px] font-semibold leading-none tracking-[-0.03em]">{{ value }}</span>
      <span v-if="unit" class="font-mono text-[11px] text-muted-foreground">{{ unit }}</span>
    </div>
    <p class="mt-2 truncate text-[11px] text-muted-foreground">{{ hint }}</p>
    <div class="-mx-1 mt-2 opacity-70">
      <Sparkline :data="data" :height="30" :stroke="tone === 'danger' ? 'var(--danger)' : 'var(--foreground)'" />
    </div>
  </div>
</template>
