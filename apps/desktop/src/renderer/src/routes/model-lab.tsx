import { createFileRoute } from '@tanstack/react-router';
import { ModelLab } from '@/features/model-lab/model-lab';

export const Route = createFileRoute('/model-lab')({ component: ModelLabPage });
function ModelLabPage() {
  const { engineClient } = Route.useRouteContext();
  return <ModelLab engineClient={engineClient} />;
}
