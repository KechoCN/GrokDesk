import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./renderer', import.meta.url)) } },
  base: './',
  build: { outDir: 'renderer-dist', emptyOutDir: true, license: { fileName: 'THIRD-PARTY-LICENSES.md' } },
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
});
