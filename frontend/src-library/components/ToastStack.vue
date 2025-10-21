<template>
  <transition-group name="toast-fade" tag="div" class="toast-stack">
    <div
      v-for="toast in toasts"
      :key="toast.id"
      class="toast-card"
      :class="`toast-${toast.variant || 'info'}`"
    >
      {{ toast.message }}
    </div>
  </transition-group>
</template>

<script>
export default {
  name: 'ToastStack',
  props: {
    toasts: {
      type: Array,
      default: () => [],
    },
  },
}
</script>
