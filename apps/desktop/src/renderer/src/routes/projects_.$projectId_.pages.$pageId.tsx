import { createFileRoute } from '@tanstack/react-router';
import { ProjectCanvas } from '@/features/projects/canvas/project-canvas';

export const Route = createFileRoute('/projects_/$projectId_/pages/$pageId')({
  component: PageRoute,
});
function PageRoute() {
  const { projectId, pageId } = Route.useParams();
  const { engineClient } = Route.useRouteContext();
  return (
    <ProjectCanvas
      key={`${projectId}/${pageId}`}
      engineClient={engineClient}
      projectId={projectId}
      pageId={pageId}
    />
  );
}
