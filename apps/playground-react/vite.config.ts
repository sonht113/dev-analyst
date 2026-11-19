import { demoApi } from './demo-api.js';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { devanalyst } from '@devanalyst/vite-plugin';

export default defineConfig({ plugins: [demoApi(), react(), devanalyst()] });
