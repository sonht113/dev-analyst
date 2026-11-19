<script setup lang="ts">
import { ref } from 'vue';
const expanded = ref(false);
</script>
<template>
  <article>
    <h2>注文ページ</h2>
    <button id="route-action" @click="expanded = !expanded">注文詳細</button>
    <p v-if="expanded">詳細</p>
  </article>
</template>
