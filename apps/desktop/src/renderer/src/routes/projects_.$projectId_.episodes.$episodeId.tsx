import { createFileRoute } from '@tanstack/react-router';
import { BlockId } from '@frame-loom/contracts';
import { ScriptPage } from '@/features/projects/script/script-page';

export const Route = createFileRoute('/projects_/$projectId_/episodes/$episodeId')({
  validateSearch: (search: Record<string, unknown>): { block?: string } => {
    const block = BlockId.safeParse(search.block);
    return block.success ? { block: block.data } : {};
  },
  component: EpisodeRoute,
});
function EpisodeRoute() {
  const { projectId, episodeId } = Route.useParams();
  const { block } = Route.useSearch();
  return <ScriptPage projectId={projectId} episodeId={episodeId} blockId={block} />;
}
