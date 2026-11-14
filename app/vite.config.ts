import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 計算ロジックは ../core/src を直接読み込む（@core）
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@core': fileURLToPath(new URL('../core/src/index.ts', import.meta.url)) } },
  server: { fs: { allow: ['..'] } },
});
