import { defineConfig } from 'vite';
export default defineConfig({
  server: {
    port: 5190,
    proxy: { '/api': 'http://localhost:8791', '/art': 'http://localhost:8791', '/chogs.json': 'http://localhost:8791' },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
