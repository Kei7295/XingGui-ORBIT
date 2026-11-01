<script setup>
import { Loader2 } from 'lucide-vue-next'

defineProps({
  variant: { type: String, default: 'secondary' },
  size: { type: String, default: 'md' },
  loading: { type: Boolean, default: false },
  disabled: { type: Boolean, default: false },
  iconOnly: { type: Boolean, default: false },
  block: { type: Boolean, default: false }
})
</script>

<template>
  <button
    class="btn"
    :class="[
      `btn-${variant}`,
      size === 'sm' ? 'btn-sm' : size === 'lg' ? 'btn-lg' : '',
      iconOnly ? 'btn-icon' : '',
      block ? 'w-full' : ''
    ]"
    :disabled="disabled || loading"
    type="button"
  >
    <Loader2 v-if="loading" :size="size === 'sm' ? 13 : 15" class="spin" />
    <template v-else>
      <slot name="icon" />
      <slot />
    </template>
  </button>
</template>
