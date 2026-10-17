import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(() => {
  return {
    plugins: [
      react(),
      tailwindcss(),
    ],
    define: {
      global: 'globalThis',
      Buffer: 'globalThis.Buffer',
      process: 'globalThis.process ?? { env: {} }',
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    // Only the direct Solana client dependency needs pre-bundling here.
    // The extra @solana-program packages are not installed in this project,
    // so keeping them in optimizeDeps causes startup warnings without helping
    // the actual runtime flow.
    optimizeDeps: {
      include: ['@solana/kit'],
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
