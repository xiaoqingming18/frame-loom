import { Outlet, useNavigate, useRouteContext, useSearch } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { TooltipProvider } from '@/components/ui/tooltip';
import { healthQueryOptions } from '@/features/engine-status/api/health';
import { TitleBar } from './title-bar';
import { Sidebar } from './sidebar';
import { SettingsDialog } from './settings-dialog';
import type { SettingsTab } from './settings-search';

export function AppShell() {
  const { engineClient } = useRouteContext({ from: '__root__' });
  const { settings } = useSearch({ from: '__root__' });
  const navigate = useNavigate();
  const health = useQuery(healthQueryOptions(engineClient));
  function setSettings(tab?: SettingsTab) {
    void navigate({ to: '.', search: (previous) => ({ ...previous, settings: tab }) });
  }
  return (
    <TooltipProvider>
      <div className="flex h-dvh flex-col">
        <TitleBar onAbout={() => setSettings('about')} />
        <div className="flex min-h-0 flex-1">
          <Sidebar hasError={health.isError} onSettings={() => setSettings('appearance')} />
          <main className="canvas-grid min-w-0 flex-1 overflow-y-auto rounded-tl-2xl border-t border-l bg-canvas">
            <Outlet />
          </main>
        </div>
      </div>
      <SettingsDialog tab={settings} onTabChange={setSettings} engineClient={engineClient} />
    </TooltipProvider>
  );
}
