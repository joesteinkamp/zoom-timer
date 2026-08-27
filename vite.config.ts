import { defineConfig } from 'vite';
import { resolve } from 'node:path';

/**
 * The M0 audio-share spike opens a computer-audio share and plays test tones
 * into whatever meeting it is run in. That is exactly what it is for, and
 * exactly why it must not be reachable on the deployed app: an unlisted page
 * a reviewer or a passer-by can find at /spike/.
 *
 * So it builds only on demand -- always in `vite dev`, and in a production
 * build only when INCLUDE_SPIKE is set, which is how the end-to-end test
 * builds the bundle it checks the spike page in.
 */
export default defineConfig(({ command }) => {
  const includeSpike = command === 'serve' || process.env.INCLUDE_SPIKE === '1';

  return {
    build: {
      outDir: process.env.OUT_DIR ?? 'dist',
      rollupOptions: {
        input: {
          main: resolve(__dirname, 'index.html'),
          ...(includeSpike ? { spike: resolve(__dirname, 'spike/index.html') } : {}),
        },
      },
    },
    server: { port: 3000 },
  };
});
