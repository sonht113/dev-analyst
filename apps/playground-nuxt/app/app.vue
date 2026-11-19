<script setup lang="ts">
import { onMounted, ref } from 'vue';
import './demo.css';
const count = ref(0),
  hydrated = ref(false);
onMounted(() => {
  hydrated.value = true;
});
</script>
<template>
  <div class="demo-shell">
    <aside class="sidebar">
      <div class="brand"><span class="brand-mark">DA</span>DevAnalyst</div>
      <div class="workspace"><strong>注文管理ワークスペース</strong>日本 · テスト環境</div>
      <div>
        <p class="nav-label">ワークスペース</p>
        <nav aria-label="ワークスペース内の移動">
          <a class="active" href="#orders"><span class="nav-symbol">▤</span>注文</a
          ><a href="#insights"><span class="nav-symbol">▥</span>概要</a
          ><a href="#activity"><span class="nav-symbol">◷</span>操作履歴</a>
        </nav>
      </div>
      <div class="sidebar-foot">
        <strong>操作の流れを確認</strong>絞り込み → 選択 → 承認<br />サンプルデータのみを使用し、実際のアカウントは使用しません。
      </div>
    </aside>
    <main class="demo-main">
      <header class="topbar">
        <div class="breadcrumbs">ワークスペース <span> / </span><strong>注文</strong></div>
        <div class="topbar-right">
          <span class="demo-pill">● サンプルデータ</span><span class="muted">日本・東京</span
          ><span class="avatar" aria-label="デモユーザー">HT</span>
        </div>
      </header>
      <div class="lab">
        <strong>Nuxt ハイドレーション検証</strong
        ><span class="muted">画面遷移後もレイアウトの状態を保持します</span
        ><button id="counter" type="button" :disabled="!hydrated" @click="count += 1">
          カウント: {{ count }}</button
        ><NuxtLink class="btn" to="/">ダッシュボード</NuxtLink
        ><NuxtLink class="btn" to="/orders/42">注文42</NuxtLink>
      </div>
      <NuxtPage />
    </main>
  </div>
</template>
