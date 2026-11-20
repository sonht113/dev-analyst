import { demoApi } from './demo-api.js';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { devanalyst } from '@sonht113/vite-plugin';

export default defineConfig({ plugins: [demoApi(), react(), devanalyst()] });
