import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DynamicProvider } from '@dynamic-labs-sdk/react-hooks';
import { createRoot } from 'react-dom/client';
import { addWaasSolanaExtension } from '@dynamic-labs-sdk/solana/waas';
import App from './App.tsx';
import { loadRuntimeConfig } from './config/runtime';
import { getDynamicClient } from './dynamicClient';
import './index.css';

const queryClient = new QueryClient();

/**
 * The browser entry point.
 *
 * The runtime configuration is fetched BEFORE anything renders. The
 * deployment knows its own URL, its own RPC and its own Dynamic environment;
 * the bundle was built before any of them was known, so the values have to
 * arrive before the first read.
 *
 * The Dynamic client is created after that, for the same reason: it needs
 * the environment, and the extension attaches to the default client.
 */
async function bootstrap(): Promise<void> {
  await loadRuntimeConfig();

  // The client must exist before the extension registers: `addWaasSolanaExtension`
  // attaches to the default client. This module is the browser entry point, so it
  // is never reached by the test suite.
  const dynamicClient = getDynamicClient();
  addWaasSolanaExtension();

  createRoot(document.getElementById('root')!).render(
    <QueryClientProvider client={queryClient}>
      <DynamicProvider client={dynamicClient}>
        <App />
      </DynamicProvider>
    </QueryClientProvider>
  );
}

void bootstrap();
