<script setup>
const props = defineProps({
  modelValue: { type: Boolean, default: false },
  disabled: { type: Boolean, default: false }
})
const emit = defineEmits(['update:modelValue'])

function toggle() {
  if (props.disabled) return
  emit('update:modelValue', !props.modelValue)
}
</script>

<template>
  <button
    type="button"
    class="switch"
    :data-on="!!modelValue"
    :disabled="disabled"
    :aria-checked="!!modelValue"
    role="switch"
    @click="toggle"
  />
</template>
