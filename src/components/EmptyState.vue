<script setup>
import { Inbox } from 'lucide-vue-next'

defineProps({
  title: { type: String, default: '暂无数据' },
  description: { type: String, default: '' }
})
</script>

<template>
  <div class="flex flex-col items-center justify-center px-6 py-14 text-center">
    <div class="mb-4 flex h-12 w-12 items-center justify-center rounded-lg border border-dashed border-border-strong text-muted-foreground">
      <slot name="icon"><Inbox :size="18" /></slot>
    </div>
    <p class="text-[13px] font-medium">{{ title }}</p>
    <p v-if="description" class="mt-1 max-w-xs text-[12px] leading-relaxed text-muted-foreground">
      {{ description }}
    </p>
    <div v-if="$slots.action" class="mt-4">
      <slot name="action" />
    </div>
  </div>
</template>
