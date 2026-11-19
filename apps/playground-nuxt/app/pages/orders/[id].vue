<script setup lang="ts">
import { ref, computed } from 'vue';
import { saveOrder } from '../../services/orders';
const count = ref(0);
const ready = computed(() => count.value < 3);
function save() {
  count.value++;
  saveOrder();
}
</script>
<template>
  <article v-if="ready">
    <h2>Nuxt 注文詳細</h2>
    <button id="route-action" :disabled="count > 1" @click="save">注文詳細</button>
    <p>{{ count }}</p>
  </article>
</template>
