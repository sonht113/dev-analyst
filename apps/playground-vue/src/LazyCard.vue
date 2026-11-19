<script setup lang="ts">
import { ref } from 'vue';
const count = ref(0);
</script>
<template>
  <aside>
    <button id="lazy" @click="count++">遅延読み込み {{ count }}</button>
  </aside>
</template>
