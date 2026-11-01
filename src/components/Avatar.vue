<script setup>
import { computed } from 'vue'

const props = defineProps({
  text: { type: String, default: '?' },
  size: { type: Number, default: 36 },
  status: { type: String, default: '' },
  round: { type: Boolean, default: false }
})

const fontSize = computed(() => Math.max(10, Math.round(props.size * 0.32)))
</script>

<template>
  <span
    class="relative inline-flex shrink-0 items-center justify-center border border-border bg-muted font-mono font-medium text-foreground/80"
    :class="round ? 'rounded-full' : 'rounded-md'"
    :style="{ width: `${size}px`, height: `${size}px`, fontSize: `${fontSize}px` }"
  >
    {{ text }}
    <span
      v-if="status"
      class="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2"
      :style="{
        background: status === 'online' ? 'var(--success)' : 'var(--subtle-foreground)',
        borderColor: 'var(--background)'
      }"
    />
  </span>
</template>
