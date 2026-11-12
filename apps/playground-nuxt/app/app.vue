<script setup lang="ts">
import { onMounted, ref } from 'vue';

const count = ref(0);
const hydrated = ref(false);

// SSR renders before handlers are attached; keep early clicks from being lost.
onMounted(() => {
  hydrated.value = true;
});
</script>

<template>
  <main>
    <h1>DevAnalyst Nuxt playground</h1>
    <p>Nuxt 4 foundation. Inspector and AI are not enabled.</p>
    <button type="button" :disabled="!hydrated" @click="count += 1">Count: {{ count }}</button>
  </main>
</template>
