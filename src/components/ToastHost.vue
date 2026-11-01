<script setup>
import { CircleCheck, CircleX, TriangleAlert, Info, X } from 'lucide-vue-next'
import { toasts, dismissToast } from '../lib/store'

const icons = { success: CircleCheck, danger: CircleX, warning: TriangleAlert, info: Info, default: Info }
const colors = {
  success: 'var(--success)',
  danger: 'var(--danger)',
  warning: 'var(--warning)',
  info: 'var(--info)',
  default: 'var(--muted-foreground)'
}
</script>

<template>
  <div class="pointer-events-none fixed bottom-4 right-4 z-[70] flex w-[min(360px,calc(100vw-2rem))] flex-col gap-2">
    <TransitionGroup name="toast">
      <div
        v-for="t in toasts"
        :key="t.id"
        class="pointer-events-auto flex items-start gap-3 rounded-lg border border-border bg-surface/95 p-3.5 shadow-lg backdrop-blur"
      >
        <component :is="icons[t.tone] || Info" :size="16" class="mt-0.5 shrink-0" :style="{ color: colors[t.tone] || colors.default }" />
        <div class="min-w-0 flex-1">
          <p class="text-[13px] font-medium leading-snug">{{ t.title }}</p>
          <p v-if="t.description" class="mt-1 text-[11.5px] leading-relaxed text-muted-foreground">
            {{ t.description }}
          </p>
        </div>
        <button class="btn btn-ghost btn-sm -mr-1 -mt-1 h-6 w-6 shrink-0" @click="dismissToast(t.id)">
          <X :size="13" />
        </button>
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.toast-enter-active,
.toast-leave-active {
  transition: transform 0.32s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.25s ease;
}
.toast-enter-from {
  opacity: 0;
  transform: translateX(16px) scale(0.98);
}
.toast-leave-to {
  opacity: 0;
  transform: translateX(16px) scale(0.98);
}
.toast-move {
  transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}
</style>
