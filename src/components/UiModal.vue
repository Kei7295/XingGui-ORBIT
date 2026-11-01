<script setup>
import { watch, onBeforeUnmount } from 'vue'
import { X } from 'lucide-vue-next'

const props = defineProps({
  open: { type: Boolean, default: false },
  title: { type: String, default: '' },
  description: { type: String, default: '' },
  width: { type: String, default: '640px' }
})
const emit = defineEmits(['close'])

function onKey(e) {
  if (e.key === 'Escape') emit('close')
}

watch(
  () => props.open,
  (open) => {
    if (open) {
      document.addEventListener('keydown', onKey)
      document.body.style.overflow = 'hidden'
    } else {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }
)

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKey)
  document.body.style.overflow = ''
})
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="open" class="fixed inset-0 z-50 flex items-end justify-center sm:items-center p-0 sm:p-6">
        <div class="absolute inset-0 bg-black/40 backdrop-blur-[3px]" @click="emit('close')" />
        <div
          class="modal-panel relative z-10 flex max-h-[92vh] w-full flex-col overflow-hidden border border-border bg-surface shadow-2xl sm:rounded-lg"
          :style="{ maxWidth: width }"
        >
          <header class="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
            <div>
              <p v-if="description" class="micro mb-1.5">{{ description }}</p>
              <h2 class="text-[15px] font-semibold tracking-[-0.01em]">{{ title }}</h2>
            </div>
            <button
              class="btn btn-ghost btn-sm btn-icon"
              type="button"
              aria-label="关闭"
              @click="emit('close')"
            >
              <X :size="16" />
            </button>
          </header>
          <div class="scroll-thin flex-1 overflow-y-auto px-5 py-5">
            <slot />
          </div>
          <footer v-if="$slots.footer" class="flex items-center justify-end gap-2 border-t border-border px-5 py-3.5">
            <slot name="footer" />
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.modal-enter-active,
.modal-leave-active {
  transition: opacity 0.22s ease;
}
.modal-enter-active .modal-panel,
.modal-leave-active .modal-panel {
  transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.25s ease;
}
.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}
.modal-enter-from .modal-panel,
.modal-leave-to .modal-panel {
  transform: translateY(14px) scale(0.985);
  opacity: 0;
}
@media (max-width: 639px) {
  .modal-panel {
    border-radius: 14px 14px 0 0;
    max-height: 90vh;
  }
}
</style>
