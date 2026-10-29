import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useRouteContext } from '@tanstack/react-router';
import { ChevronRight, FileImage, Folder, Plus } from 'lucide-react';
import {
  episodeLabel,
  type ProjectSummary,
  type EpisodeSummary,
  type ProjectPageSummary,
} from '@frame-loom/contracts';
import { Button } from '@frame-loom/ui/components/button';
import { cn } from '@frame-loom/ui/lib/utils';
import {
  preferencesQuery,
  projectQuery,
  projectsQuery,
  visibleProjects,
} from '@/lib/project-queries';
import { ProjectDialog } from './project-dialog';

export function ProjectTree() {
  const { engineClient } = useRouteContext({ from: '__root__' });
  const projects = useQuery(projectsQuery(engineClient));
  const preferences = useQuery(preferencesQuery());
  const [creating, setCreating] = useState(false);
  return (
    <>
      <div className="flex items-center justify-between pt-5 pr-4 pb-2.5 pl-6 text-xs text-muted-foreground">
        <span>项目</span>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="新建项目"
          onClick={() => setCreating(true)}
        >
          <Plus aria-hidden className="size-3.5" />
        </Button>
      </div>
      <nav aria-label="项目树" className="min-h-0 flex-1 space-y-1 overflow-y-auto px-3">
        {projects.error ? (
          <Button variant="ghost" size="sm" onClick={() => void projects.refetch()}>
            重新读取项目
          </Button>
        ) : (
          visibleProjects(projects.data ?? [], preferences.data?.projectSort ?? 'updated').map(
            (project) => <ProjectBranch key={project.id} project={project} />,
          )
        )}
      </nav>
      {creating && <ProjectDialog action={{ kind: 'create' }} onClose={() => setCreating(false)} />}
    </>
  );
}
function ProjectBranch({ project }: { project: ProjectSummary }) {
  const [expanded, setExpanded] = useState(false);
  const { engineClient } = useRouteContext({ from: '__root__' });
  const manifest = useQuery({
    ...projectQuery(engineClient, project.id),
    enabled: expanded && project.status === 'available',
  });
  return (
    <div>
      <div className="flex min-w-0 items-center">
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={project.status !== 'available'}
          aria-label={`${expanded ? '收起' : '展开'} ${project.name}`}
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          <ChevronRight
            aria-hidden
            className={cn('size-3 transition-transform', expanded && 'rotate-90')}
          />
        </Button>
        <Link
          to="/projects/$projectId"
          params={{ projectId: project.id }}
          search={{ tab: 'episodes', path: '' }}
          activeProps={{ className: 'bg-accent-active', 'aria-current': 'page' }}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-2 hover:bg-accent"
        >
          <Folder aria-hidden className="size-4 shrink-0" />
          <span className="truncate">{project.name}</span>
          {project.status !== 'available' && <span className="sr-only">不可用</span>}
        </Link>
      </div>
      {expanded && (
        <div className="ml-8 border-l pl-2">
          {manifest.isPending ? (
            <p className="p-2 text-xs text-muted-foreground">读取中…</p>
          ) : manifest.error ? (
            <Button variant="ghost" size="sm" onClick={() => void manifest.refetch()}>
              重试
            </Button>
          ) : manifest.data?.pages.length || manifest.data?.episodes?.length ? (
            <>
              {[...(manifest.data.episodes ?? [])]
                .sort((a, b) => a.number - b.number)
                .map((episode) => (
                  <EpisodeBranch
                    key={episode.id}
                    projectId={project.id}
                    episode={episode}
                    pages={manifest.data.pages.filter((page) => page.episodeId === episode.id)}
                  />
                ))}
              {manifest.data.pages
                .filter(
                  (page) =>
                    !manifest.data.episodes?.some((episode) => episode.id === page.episodeId),
                )
                .map((page) => (
                  <Link
                    key={page.id}
                    to="/projects/$projectId/pages/$pageId"
                    params={{ projectId: project.id, pageId: page.id }}
                    search={{}}
                    activeProps={{ className: 'bg-accent-active', 'aria-current': 'page' }}
                    className="flex items-center gap-2 rounded-lg px-2 py-2 hover:bg-accent"
                  >
                    <FileImage aria-hidden className="size-3.5 shrink-0" />
                    <span className="truncate">{page.name}</span>
                  </Link>
                ))}
            </>
          ) : (
            <p className="p-2 text-xs text-muted-foreground">无内容</p>
          )}
        </div>
      )}
    </div>
  );
}

function EpisodeBranch({
  projectId,
  episode,
  pages,
}: {
  projectId: string;
  episode: EpisodeSummary;
  pages: ProjectPageSummary[];
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div>
      <Button
        variant="ghost"
        className="w-full justify-start text-left"
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
      >
        <ChevronRight aria-hidden className={cn('size-3 shrink-0', expanded && 'rotate-90')} />
        <span className="truncate">{episodeLabel(episode)}</span>
      </Button>
      {expanded && (
        <div className="ml-3 border-l pl-2">
          <Link
            to="/projects/$projectId/episodes/$episodeId"
            params={{ projectId, episodeId: episode.id }}
            search={{}}
            activeProps={{ className: 'bg-accent-active', 'aria-current': 'page' }}
            className="block rounded-lg px-2 py-2 hover:bg-accent"
          >
            剧本
          </Link>
          {pages.map((page) => (
            <Link
              key={page.id}
              to="/projects/$projectId/pages/$pageId"
              params={{ projectId, pageId: page.id }}
              search={{}}
              activeProps={{ className: 'bg-accent-active', 'aria-current': 'page' }}
              className="block truncate rounded-lg px-2 py-2 hover:bg-accent"
            >
              {page.name}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
