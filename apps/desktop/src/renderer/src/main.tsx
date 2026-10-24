import React from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient } from '@tanstack/react-query';
import { AppProviders } from '@/app/providers';
import { createAppRouter } from '@/app/router';
import { getEngineConnection } from '@/lib/desktop-bridge';
import { createEngineClient } from '@/lib/engine-client';
import './styles.css';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});
const router = createAppRouter({
  engineClient: createEngineClient(getEngineConnection),
  queryClient,
});

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppProviders router={router} />
  </React.StrictMode>,
);
