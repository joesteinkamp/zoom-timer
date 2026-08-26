import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        // The M0 audio-share spike ships alongside the app so it can be
        // run against a real meeting without a separate deploy.
        spike: resolve(__dirname, 'spike/index.html'),
      },
    },
  },
  server: { port: 3000 },
});
