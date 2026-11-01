<script setup>
import { computed } from 'vue'

const props = defineProps({
  score: { type: Number, default: 0 },
  size: { type: Number, default: 220 },
  label: { type: String, default: 'RISK SCORE' }
})

const level = computed(() => (props.score >= 70 ? 'high' : props.score >= 40 ? 'medium' : 'low'))
const color = computed(() =>
  level.value === 'high' ? 'var(--danger)' : level.value === 'medium' ? 'var(--warning)' : 'var(--success)'
)
const levelText = computed(() => ({ high: '高风险', medium: '需要留意', low: '平稳' })[level.value])
</script>

<template>
  <div class="flex flex-col items-center" :style="{ width: `${size}px` }">
    <svg viewBox="0 0 160 96" class="w-full" :style="{ height: `${Math.round(size * 0.6)}px` }">
      <path
        d="M 12 90 A 68 68 0 0 1 148 90"
        fill="none"
        stroke="var(--muted)"
        stroke-width="5"
      />
      <path
        d="M 12 90 A 68 68 0 0 1 148 90"
        fill="none"
        :stroke="color"
        stroke-width="5"
        stroke-linecap="round"
        pathLength="100"
        :stroke-dasharray="`${Math.max(score, 0.4)} 100`"
        style="transition: stroke-dasharray 0.7s cubic-bezier(0.16, 1, 0.3, 1), stroke 0.3s"
      />
      <g stroke="var(--border-strong)" stroke-width="1">
        <line x1="12" y1="94" x2="12" y2="98" />
        <line x1="80" y1="16" x2="80" y2="11" />
        <line x1="148" y1="94" x2="148" y2="98" />
      </g>
    </svg>
    <div class="-mt-2 flex flex-col items-center">
      <div class="num text-[30px] font-semibold leading-none" :style="{ color }">
        {{ Math.round(score) }}
      </div>
      <div class="micro mt-2.5">{{ label }}</div>
      <div class="mt-2 flex items-center gap-1.5">
        <span class="dot" :style="{ background: color }" />
        <span class="text-[11px] text-muted-foreground">{{ levelText }}</span>
      </div>
    </div>
  </div>
</template>
