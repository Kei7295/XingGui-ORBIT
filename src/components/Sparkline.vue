<script setup>
import { computed } from 'vue'

const props = defineProps({
  data: { type: Array, default: () => [] },
  height: { type: Number, default: 36 },
  fill: { type: Boolean, default: true },
  stroke: { type: String, default: 'var(--foreground)' },
  lastDot: { type: Boolean, default: true }
})

const gradientId = `sg-${Math.random().toString(36).slice(2, 8)}`

const points = computed(() => {
  const raw = props.data.length > 1 ? props.data : [0, ...(props.data.length ? props.data : [0])]
  const min = Math.min(...raw)
  const max = Math.max(...raw)
  const span = max - min || 1
  return raw.map((v, i) => {
    const x = (i / (raw.length - 1)) * 100
    const y = props.height - 3 - ((v - min) / span) * (props.height - 7)
    return [x, y]
  })
})

const line = computed(() => points.value.map(([x, y]) => `${x},${y}`).join(' '))
const area = computed(() => `0,${props.height} ${line.value} 100,${props.height}`)
const last = computed(() => points.value[points.value.length - 1] || [100, props.height / 2])
</script>

<template>
  <svg
    :viewBox="`0 0 100 ${height}`"
    preserveAspectRatio="none"
    class="block w-full"
    :style="{ height: `${height}px` }"
    aria-hidden="true"
  >
    <defs>
      <linearGradient :id="gradientId" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" :stop-color="stroke" stop-opacity="0.16" />
        <stop offset="100%" :stop-color="stroke" stop-opacity="0" />
      </linearGradient>
    </defs>
    <polygon v-if="fill" :points="area" :fill="`url(#${gradientId})`" />
    <polyline
      :points="line"
      :stroke="stroke"
      stroke-width="1.2"
      fill="none"
      vector-effect="non-scaling-stroke"
      stroke-linecap="round"
    />
    <circle
      v-if="lastDot"
      :cx="last[0]"
      :cy="last[1]"
      r="1.8"
      :fill="stroke"
      vector-effect="non-scaling-stroke"
    />
  </svg>
</template>
