<script setup>
defineProps({
  eyebrow: { type: String, default: '' },
  title: { type: String, default: '' },
  description: { type: String, default: '' }
})
</script>

<template>
  <div class="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
    <div class="min-w-0">
      <p v-if="eyebrow" class="micro mb-2.5">{{ eyebrow }}</p>
      <h1 class="text-[24px] font-semibold leading-tight tracking-[-0.03em] sm:text-[26px]">
        {{ title }}
        <slot name="inline" />
      </h1>
      <p v-if="description" class="mt-1.5 max-w-2xl text-[13px] leading-relaxed text-muted-foreground">
        {{ description }}
      </p>
    </div>
    <div v-if="$slots.actions" class="flex flex-wrap items-center gap-2">
      <slot name="actions" />
    </div>
  </div>
</template>
