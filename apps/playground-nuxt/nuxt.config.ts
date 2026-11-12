import { defineNuxtConfig } from 'nuxt/config';

export default defineNuxtConfig({
  compatibilityDate: '2026-11-12',
  devtools: { enabled: false },
  telemetry: false,
  typescript: { strict: true },
  app: {
    head: { title: 'DevAnalyst Nuxt playground', htmlAttrs: { lang: 'en' } },
  },
});
