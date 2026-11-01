<script setup>
defineProps({
  title: { type: String, default: '' },
  eyebrow: { type: String, default: '' },
  description: { type: String, default: '' },
  flush: { type: Boolean, default: false },
  hover: { type: Boolean, default: false }
})
</script>

<template>
  <section class="card" :class="hover ? 'card-hover' : ''">
    <header v-if="title || eyebrow || $slots.actions" class="card-head">
      <div class="min-w-0">
        <p v-if="eyebrow" class="micro mb-2">{{ eyebrow }}</p>
        <h2 v-if="title" class="card-title truncate">{{ title }}</h2>
        <p v-if="description" class="mt-1 text-[12px] leading-relaxed text-muted-foreground">
          {{ description }}
        </p>
      </div>
      <div v-if="$slots.actions" class="flex shrink-0 items-center gap-2">
        <slot name="actions" />
      </div>
    </header>
    <div :class="flush ? '' : 'card-body'">
      <slot />
    </div>
    <footer v-if="$slots.footer" class="border-t border-border px-4 py-3">
      <slot name="footer" />
    </footer>
  </section>
</template>
