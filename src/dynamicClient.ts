import { createDynamicClient } from '@dynamic-labs-sdk/client';
import { addWaasSolanaExtension } from '@dynamic-labs-sdk/solana/waas';

const environmentId = import.meta.env.VITE_DYNAMIC_ENVIRONMENT_ID;

if (!environmentId) {
  throw new Error('Set VITE_DYNAMIC_ENVIRONMENT_ID to your Dynamic environment ID.');
}

export const dynamicClient = createDynamicClient({
  environmentId,
  metadata: {
    name: 'ReWallet',
    universalLink: window.location.origin,
  },
});

addWaasSolanaExtension();
