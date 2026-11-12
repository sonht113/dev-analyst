import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { devanalyst } from '@devanalyst/vite-plugin';

export default defineConfig({ plugins: [react(), devanalyst()] });
