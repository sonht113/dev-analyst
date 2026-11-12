<script setup lang="ts">
import { ref } from 'vue';

const count = ref(0);
</script>

<template>
  <main>
    <h1>DevAnalyst Vue playground</h1>
    <p>Vue 3 + Vite foundation. Inspector and AI are not enabled.</p>
    <button type="button" @click="count += 1">Count: {{ count }}</button>
  </main>
</template>
