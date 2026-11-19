import { defineNuxtConfig } from 'nuxt/config';

export default defineNuxtConfig({
  modules: ['@devanalyst/nuxt-module'],
  compatibilityDate: '2026-11-12',
  devtools: { enabled: false },
  telemetry: false,
  typescript: { strict: true },
  app: {
    head: { title: 'DevAnalyst Nuxt 検証環境', htmlAttrs: { lang: 'ja' } },
  },
});
