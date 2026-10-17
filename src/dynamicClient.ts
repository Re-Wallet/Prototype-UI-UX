import { createDynamicClient } from '@dynamic-labs-sdk/client';

let client: ReturnType<typeof createDynamicClient> | undefined;

/**
 * Lazily construct the Dynamic client.
 *
 * Nothing may run at import time: this module is reachable from the adapter
 * barrel, so a module-scope `import.meta.env` read or `window` access would
 * make every pure service that imports the barrel untestable outside Vite.
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
  }
  return client;
}
