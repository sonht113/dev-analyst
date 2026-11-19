import { demoApi } from './demo-api.js';
import vue from '@vitejs/plugin-vue';
import { devanalystVue } from '@devanalyst/vue-plugin';
import { defineConfig } from 'vite';

export default defineConfig({ plugins: [demoApi(), devanalystVue(), vue()] });
