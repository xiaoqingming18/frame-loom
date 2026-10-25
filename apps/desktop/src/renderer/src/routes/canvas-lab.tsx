import { createFileRoute } from '@tanstack/react-router';
import { CanvasLab } from '@/features/canvas-lab/canvas-lab';

export const Route = createFileRoute('/canvas-lab')({ component: CanvasLabPage });
function CanvasLabPage() {
  const { engineClient } = Route.useRouteContext();
  return <CanvasLab engineClient={engineClient} />;
}
