import { defineConfig } from 'vite';

const server = `localhost:${process.env.PORT || 8080}`;

export default defineConfig({
  root: '.',
  publicDir: 'public',
  build: {
    outDir: 'dist',
    target: 'es2022',
    chunkSizeWarningLimit: 800,
  },
  server: {
    host: true,
    proxy: {
      '/ws': { target: `ws://${server}`, ws: true },
      '/version': `http://${server}`,
    },
  },
});
