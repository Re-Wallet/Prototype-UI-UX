import { createRequire } from 'node:module';
import { createDynamicClient } from '@dynamic-labs-sdk/client';

const require = createRequire(import.meta.url);

let client: ReturnType<typeof createDynamicClient> | undefined;

/**
 * Lazily construct the Dynamic client.
 *
 * Nothing may run at import time: this module is reachable from the adapter
 * barrel, so a module-scope `import.meta.env` read, `window` access, or a
 * third-party module load would make every pure service that imports the barrel
 * untestable outside Vite.
 */
export function getDynamicClient() {
  if (!client) {
    const environmentId = import.meta.env?.VITE_DYNAMIC_ENVIRONMENT_ID;
    if (!environmentId) {
      throw new Error('Set VITE_DYNAMIC_ENVIRONMENT_ID to your Dynamic environment ID.');
    }
    client = createDynamicClient({
      environmentId,
      metadata: {
        name: 'ReWallet',
        universalLink: window.location.origin,
      },
    });
    // Required lazily, not statically: importing `@dynamic-labs-sdk/solana/waas`
    // at module scope runs `assertPackageVersion`, which aborts the process under
    // `node --test`. It must also run after the client exists, since it registers
    // the extension on the default client.
    const { addWaasSolanaExtension } = require('@dynamic-labs-sdk/solana/waas');
    addWaasSolanaExtension();
  }
  return client;
}
