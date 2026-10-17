import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DynamicProvider } from '@dynamic-labs-sdk/react-hooks';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { dynamicClient } from './dynamicClient';
import './index.css';

const queryClient = new QueryClient();

createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={queryClient}>
    <DynamicProvider client={dynamicClient}>
      <App />
    </DynamicProvider>
  </QueryClientProvider>
);
