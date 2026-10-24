import { createHashHistory, createRouter, type RouterHistory } from '@tanstack/react-router';
import type { QueryClient } from '@tanstack/react-query';
import type { EngineClient } from '@/lib/engine-client';
import { routeTree } from '@/routeTree.gen';

export interface RouterContext {
  engineClient: EngineClient;
  queryClient: QueryClient;
}

export function createAppRouter(context: RouterContext, history?: RouterHistory) {
  if (!history) {
    if (!window.location.hash) window.history.replaceState(null, '', '#/');
    history = createHashHistory();
  }
  return createRouter({ routeTree, history, context });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
