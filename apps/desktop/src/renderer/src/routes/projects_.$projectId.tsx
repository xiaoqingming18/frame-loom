import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { AssetDirectoryPath } from '@frame-loom/contracts';
import { ProjectDetail } from '@/features/projects/project-detail';

export const projectSearch = z.object({
  tab: z.enum(['episodes', 'pages', 'story', 'assets']).catch('episodes'),
  path: AssetDirectoryPath.catch(''),
});
export const Route = createFileRoute('/projects_/$projectId')({
  validateSearch: (search) => projectSearch.parse(search),
  component: DetailRoute,
});
function DetailRoute() {
  const { projectId } = Route.useParams();
  const { tab, path } = Route.useSearch();
  return <ProjectDetail projectId={projectId} tab={tab} path={path} />;
}
