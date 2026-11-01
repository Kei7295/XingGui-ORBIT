<script setup>
defineProps({ size: { type: Number, default: 26 } })
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 32 32"
    fill="none"
    aria-hidden="true"
    class="shrink-0"
  >
    <rect x="0.75" y="0.75" width="30.5" height="30.5" rx="8.5" stroke="currentColor" stroke-opacity="0.9" />
    <ellipse
      cx="16"
      cy="16"
      rx="10.5"
      ry="5.2"
      transform="rotate(-32 16 16)"
      stroke="currentColor"
      stroke-opacity="0.55"
      stroke-width="1"
    />
    <circle cx="23.6" cy="9.6" r="2.4" fill="currentColor" />
    <circle cx="16" cy="16" r="1.5" fill="currentColor" fill-opacity="0.5" />
    <path d="M4.5 24.5 L27.5 7.5" stroke="currentColor" stroke-opacity="0.18" stroke-dasharray="2 3" />
  </svg>
</template>
