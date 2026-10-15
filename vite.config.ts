import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(() => {
  return {
    plugins: [
      // Privy pulls in @coinbase/wallet-sdk, which references the Node `process`
      // global. Without this polyfill the browser throws "process is not defined".
      // See: https://docs.privy.io/basics/troubleshooting/react-frameworks (Vite tab)
      nodePolyfills({
        globals: { process: true, Buffer: true, global: true },
      }),
      react(),
      tailwindcss(),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    // Solana peer dependencies are resolved during dependency pre-bundling.
    // They must be listed here so Vite does not treat them as optional and
    // emit "__vite-optional-peer-dep" resolution errors.
    optimizeDeps: {
      include: [
        '@solana/kit',
        '@solana-program/memo',
        '@solana-program/system',
        '@solana-program/token',
        '@solana-commerce/solana-pay',
      ],
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
