import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DynamicProvider } from '@dynamic-labs-sdk/react-hooks';
import { createRoot } from 'react-dom/client';
import { addWaasSolanaExtension } from '@dynamic-labs-sdk/solana/waas';
import App from './App.tsx';
import { getDynamicClient } from './dynamicClient';
import './index.css';

const queryClient = new QueryClient();

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
