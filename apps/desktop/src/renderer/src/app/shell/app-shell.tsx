import {
  Outlet,
  useNavigate,
  useRouteContext,
  useRouterState,
  useSearch,
} from '@tanstack/react-router';
import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { TooltipProvider } from '@frame-loom/ui/components/tooltip';
import { cn } from '@frame-loom/ui/lib/utils';
import { engineStatusKeys, healthQueryOptions } from '@/features/engine-status/api/health';
import { onEngineExited } from '@/lib/desktop-bridge';
import { TitleBar } from './title-bar';
import { Sidebar } from './sidebar';
import { SettingsDialog } from './settings-dialog';
import type { SettingsTab } from './settings-search';

export function AppShell() {
  const { engineClient } = useRouteContext({ from: '__root__' });
  const { settings } = useSearch({ from: '__root__' });
  const navigate = useNavigate();
  const health = useQuery(healthQueryOptions(engineClient));
  const queryClient = useQueryClient();
  const fullBleed = useRouterState({
    select: (state) => /^\/projects\/[^/]+\/pages\/[^/]+\/?$/.test(state.location.pathname),
  });
  useEffect(
    () =>
      onEngineExited(() => {
        void queryClient.invalidateQueries({ queryKey: engineStatusKeys.health() });
      }),
    [queryClient],
  );
  function setSettings(tab?: SettingsTab) {
    void navigate({ to: '.', search: (previous) => ({ ...previous, settings: tab }) });
  }
  return (
    <TooltipProvider>
      <div className="flex h-dvh flex-col">
        <TitleBar onAbout={() => setSettings('about')} />
        <div className="flex min-h-0 flex-1">
          <Sidebar hasError={health.isError} onSettings={() => setSettings('appearance')} />
          <main
            className={cn(
              'min-w-0 flex-1 rounded-tl-2xl border-t border-l bg-canvas',
              // 画布自带随视口移动的点阵，且自行处理平移，主区不再滚动。
              fullBleed ? 'overflow-hidden' : 'canvas-grid overflow-y-auto',
            )}
          >
            <Outlet />
          </main>
        </div>
      </div>
      <SettingsDialog tab={settings} onTabChange={setSettings} engineClient={engineClient} />
    </TooltipProvider>
  );
}
