import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * The build identity that goes into every bug report.
 *
 * "Which version was the user on?" is the first question of any triage, and
 * the only honest answer is the commit the running bundle was built from.
 */
function buildIdentity(): { version: string; commit: string } {
  let version = '0.0.0';
  try {
    version = JSON.parse(readFileSync(path.resolve(__dirname, 'package.json'), 'utf8')).version;
  } catch {
    // A missing package.json must not break the build.
  }

  let commit = 'unknown';
  try {
    commit = execSync('git rev-parse --short HEAD', {
      cwd: __dirname,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
  } catch {
    // A build outside a git checkout still ships, just without the commit.
  }

  return { version, commit };
}

export default defineConfig(() => {
  const identity = buildIdentity();

  return {
    plugins: [
      react(),
      tailwindcss(),
    ],
    define: {
      global: 'globalThis',
      Buffer: 'globalThis.Buffer',
      process: 'globalThis.process ?? { env: {} }',
      __APP_VERSION__: JSON.stringify(identity.version),
      __APP_COMMIT__: JSON.stringify(identity.commit),
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
      /**
       * Allowed request hosts.
       *
       * Vite rejects requests whose Host header it does not recognise — a
       * DNS-rebinding guard. A Cloudflare tunnel arrives with its own
       * hostname, so the dev server answered 403 to everything until the
       * tunnel's domain was allowed here.
       *
       * The leading dot is a suffix match, so it covers every quick tunnel
       * URL, including the ones regenerated on each restart.
       */
      allowedHosts: ['.trycloudflare.com'],
      /**
       * Proxy `/api` to the API process.
       *
       * The browser calls the API same-origin and relative (see
       * `API_BASE` in src/services/walletApi.ts), so this proxy is what makes
       * it work in every context: the local dev server, and a tunnel that
       * exposes only the frontend — which is what a payer opening `/pay` from
       * another device needs, since `127.0.0.1` there would be their own
       * machine.
       */
      proxy: {
        '/api': {
          target: `http://127.0.0.1:${process.env.API_PORT ?? 3001}`,
          changeOrigin: true,
        },
      },
    },
  };
});
