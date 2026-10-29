import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useRouteContext } from '@tanstack/react-router';
import {
  ArrowDownWideNarrow,
  FileImage,
  FolderOpen,
  MoreHorizontal,
  Plus,
  Search,
} from 'lucide-react';
import type { ProjectSort, ProjectSummary } from '@frame-loom/contracts';
import { formatProfile } from '@frame-loom/contracts';
import { Button } from '@frame-loom/ui/components/button';
import { Input } from '@frame-loom/ui/components/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@frame-loom/ui/components/dropdown-menu';
import { preferencesQuery, projectsQuery, visibleProjects } from '@/lib/project-queries';
import { revealProject, setPreferences } from '@/lib/desktop-bridge';
import { ProjectDialog, type ProjectAction } from './project-dialog';

const sortLabels = { updated: '最近修改', created: '创建时间', name: '名称' };
const projectStatusLabels = {
  available: '',
  missing: '项目文件夹已移动或不存在',
  mismatch: '项目身份不匹配',
  unreadable: '项目无法读取或已损坏',
  too_new: '需要更新应用',
};

export function ProjectLibrary() {
  const { engineClient } = useRouteContext({ from: '__root__' });
  const queryClient = useQueryClient();
  const projects = useQuery(projectsQuery(engineClient));
  const preferences = useQuery(preferencesQuery());
  const [search, setSearch] = useState('');
  const [action, setAction] = useState<ProjectAction | null>(null);
  const [error, setError] = useState('');
  const sort = preferences.data?.projectSort ?? 'updated';
  const saveSort = useMutation({
    mutationFn: (projectSort: ProjectSort) => setPreferences({ projectSort }),
    onSuccess: (value) => queryClient.setQueryData(preferencesQuery().queryKey, value),
  });
  const list = visibleProjects(projects.data ?? [], sort, search);
  return (
    <section className="mx-auto max-w-6xl p-6 lg:p-10">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">项目库</h1>
          <p className="mt-2 text-sm text-muted-foreground">让每个故事，都有自己的空间。</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            className="rounded-full"
            onClick={() => setAction({ kind: 'open' })}
          >
            <FolderOpen aria-hidden />
            打开已有项目
          </Button>
          <Button className="rounded-full" onClick={() => setAction({ kind: 'create' })}>
            <Plus aria-hidden />
            新建项目
          </Button>
        </div>
      </header>
      <div className="mt-8 mb-6 flex items-center gap-3">
        <div className="relative min-w-0 flex-1">
          <Search aria-hidden className="absolute top-2.5 left-3 size-4 text-muted-foreground" />
          <Input
            aria-label="搜索项目"
            placeholder="搜索项目…"
            className="rounded-full bg-muted pl-9"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              disabled={saveSort.isPending || !preferences.data}
              aria-label={`项目排序：${sortLabels[sort]}`}
            >
              <ArrowDownWideNarrow aria-hidden />
              {sortLabels[sort]}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuRadioGroup
              value={sort}
              onValueChange={(value) => saveSort.mutate(value as ProjectSort)}
            >
              {Object.entries(sortLabels).map(([value, label]) => (
                <DropdownMenuRadioItem key={value} value={value}>
                  {label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {(error || saveSort.error || preferences.error) && (
        <p role="alert" className="mb-4 text-destructive">
          {error || saveSort.error?.message || preferences.error?.message}
        </p>
      )}
      {projects.isPending ? (
        <p role="status">正在读取项目…</p>
      ) : projects.error ? (
        <div role="alert">
          {projects.error.message}
          <Button variant="ghost" onClick={() => void projects.refetch()}>
            重新读取
          </Button>
        </div>
      ) : list.length === 0 ? (
        <div className="grid min-h-60 place-content-center gap-3 text-center">
          <FolderOpen aria-hidden className="mx-auto size-10 text-project-paper-icon" />
          <h2 className="font-medium">{search ? '没有找到项目' : '还没有项目'}</h2>
          <p className="text-muted-foreground">
            {search ? '试试其他名称' : '新建项目，或打开已有的本地项目文件夹。'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-6">
          {list.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              onAction={setAction}
              onError={setError}
            />
          ))}
        </div>
      )}
      {action && <ProjectDialog action={action} onClose={() => setAction(null)} />}
    </section>
  );
}

function ProjectCard({
  project,
  onAction,
  onError,
}: {
  project: ProjectSummary;
  onAction: (action: ProjectAction) => void;
  onError: (message: string) => void;
}) {
  const available = project.status === 'available';
  return (
    <article
      aria-label={project.name}
      className="group relative h-[240px] min-w-0 rounded-[20px] bg-muted transition-shadow hover:shadow-panel"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute top-6 left-1/2 flex h-[110px] w-[170px] -translate-x-1/2 items-center justify-center rounded-xl border-4 border-card bg-project-paper"
      >
        <FileImage className="size-7 text-project-paper-icon" />
      </div>
      {available ? (
        <Link
          to="/projects/$projectId"
          params={{ projectId: project.id }}
          search={{ tab: 'episodes', path: '' }}
          className="absolute inset-0 rounded-[20px] focus-visible:outline-2 focus-visible:outline-ring"
        >
          <span className="sr-only">打开项目 {project.name}</span>
        </Link>
      ) : null}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 rounded-b-[20px] border-t border-border/50 bg-background/90 px-5 pt-4 pb-5">
        <h2 className="truncate pr-8 font-semibold">{project.name}</h2>
        <p className="mt-1 truncate text-xs text-muted-foreground">
          {available
            ? `修改于 ${new Date(project.updatedAt).toLocaleDateString('zh-CN')}`
            : projectStatusLabels[project.status]}
        </p>
        <p
          className="mt-1 truncate text-xs text-muted-foreground"
          title={formatProfile(project.profile)}
        >
          {formatProfile(project.profile) || '未设置项目设定'}
        </p>
      </div>
      <div className="absolute right-3 bottom-4">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon-sm" variant="ghost" aria-label={`${project.name} 的菜单`}>
              <MoreHorizontal aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {available ? (
              <>
                <DropdownMenuItem
                  onSelect={() =>
                    onAction({ kind: 'profile', projectId: project.id, profile: project.profile })
                  }
                >
                  项目设定
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onAction({ kind: 'rename', project })}>
                  重命名
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() =>
                    void revealProject({ projectId: project.id }).catch((error: unknown) =>
                      onError(error instanceof Error ? error.message : '无法显示项目'),
                    )
                  }
                >
                  在资源管理器中显示
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onAction({ kind: 'cleanup', project })}>
                  清理未使用媒体
                </DropdownMenuItem>
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={() => onAction({ kind: 'delete', project })}
                >
                  删除
                </DropdownMenuItem>
              </>
            ) : (
              <>
                <DropdownMenuItem onSelect={() => onAction({ kind: 'relocate', project })}>
                  重新定位
                </DropdownMenuItem>
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={() => onAction({ kind: 'delete', project })}
                >
                  从项目库移除
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </article>
  );
}
