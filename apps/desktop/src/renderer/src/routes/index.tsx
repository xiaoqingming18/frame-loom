import { createFileRoute } from '@tanstack/react-router';
import { EngineStatusPage } from '@/features/engine-status/components/engine-status-page';

export const Route = createFileRoute('/')({ component: IndexPage });

function IndexPage() {
  const { engineClient } = Route.useRouteContext();
  return <EngineStatusPage engineClient={engineClient} />;
}
