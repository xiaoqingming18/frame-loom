import { useQuery } from '@tanstack/react-query';
import { Link, useRouteContext } from '@tanstack/react-router';
import { episodeLabel } from '@frame-loom/contracts';
import { projectQuery, scriptQuery } from '@/lib/project-queries';

export function ScriptPage({
  projectId,
  episodeId,
  blockId,
}: {
  projectId: string;
  episodeId: string;
  blockId?: string;
}) {
  const { engineClient } = useRouteContext({ from: '__root__' });
  const project = useQuery(projectQuery(engineClient, projectId));
  const script = useQuery(scriptQuery(engineClient, projectId, episodeId));
  const episode = project.data?.episodes?.find((episode) => episode.id === episodeId);
  return (
    <section className="flex h-full flex-col bg-background">
      <nav
        aria-label="面包屑"
        className="flex min-w-0 items-center gap-2 border-b px-5 py-4 text-sm text-muted-foreground"
      >
        <Link to="/projects" search={{}}>
          项目库
        </Link>
        <span>/</span>
        <Link
          to="/projects/$projectId"
          params={{ projectId }}
          search={{ tab: 'episodes', path: '' }}
        >
          {project.data?.name ?? '项目'}
        </Link>
        <span>/</span>
        <span className="truncate text-foreground">{episode ? episodeLabel(episode) : '剧本'}</span>
      </nav>
      {script.error ? (
        <p role="alert">{script.error.message}</p>
      ) : script.isPending ? (
        <p role="status">正在读取剧本…</p>
      ) : (
        <p data-block={blockId}>编辑器即将可用</p>
      )}
    </section>
  );
}
