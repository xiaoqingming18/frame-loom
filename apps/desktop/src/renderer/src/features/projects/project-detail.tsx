import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useRouteContext } from '@tanstack/react-router';
import { FileImage, Info, MoreHorizontal, Plus } from 'lucide-react';
import { Button } from '@frame-loom/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@frame-loom/ui/components/dropdown-menu';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@frame-loom/ui/components/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '@frame-loom/ui/components/tooltip';
import { projectQuery } from '@/lib/project-queries';
import { ProjectDialog, type ProjectAction } from './project-dialog';
import { ProjectAssets } from './project-assets';

export function ProjectDetail({
  projectId,
  tab,
  path,
}: {
  projectId: string;
  tab: 'pages' | 'assets';
  path: string;
}) {
  const { engineClient } = useRouteContext({ from: '__root__' });
  const project = useQuery(projectQuery(engineClient, projectId));
  const navigate = useNavigate();
  const [action, setAction] = useState<ProjectAction | null>(null);
  return (
    <section className="mx-auto max-w-6xl p-6 lg:p-10">
      <nav
        aria-label="面包屑"
        className="mb-6 flex min-w-0 items-center gap-2 text-muted-foreground"
      >
        <Link to="/projects" search={{}}>
          项目库
        </Link>
        <span aria-hidden>/</span>
        <span className="truncate text-foreground">{project.data?.name ?? '项目'}</span>
      </nav>
      {project.isPending ? (
        <p role="status">正在读取项目…</p>
      ) : project.error ? (
        <p role="alert">
          {project.error.message}
          <Button variant="ghost" onClick={() => void project.refetch()}>
            重新读取
          </Button>
        </p>
      ) : (
        project.data && (
          <>
            <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
              <h1 className="min-w-0 truncate text-2xl font-semibold">{project.data.name}</h1>
              {tab === 'pages' && (
                <Button
                  className="rounded-full"
                  onClick={() => setAction({ kind: 'create-page', projectId })}
                >
                  <Plus aria-hidden />
                  新建创作页
                </Button>
              )}
            </header>
            <Tabs
              value={tab}
              onValueChange={(value) =>
                void navigate({
                  to: '/projects/$projectId',
                  params: { projectId },
                  search: (previous) => ({ ...previous, tab: value as 'pages' | 'assets', path }),
                })
              }
            >
              <div className="mb-6 flex items-center gap-2 border-b">
                <TabsList variant="line">
                  <TabsTrigger value="pages">创作页</TabsTrigger>
                  <TabsTrigger value="assets">项目资产</TabsTrigger>
                </TabsList>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon-sm" aria-label="项目组织说明">
                      <Info aria-hidden />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>创作页是独立画布，项目资产是本地文件夹中的素材。</TooltipContent>
                </Tooltip>
              </div>
              <TabsContent value="pages">
                {project.data.pages.length === 0 ? (
                  <div className="grid min-h-60 place-content-center gap-3 text-center">
                    <FileImage aria-hidden className="mx-auto size-10 text-project-paper-icon" />
                    <h2>还没有创作页</h2>
                    <p className="text-muted-foreground">从第一张画布开始，组织你的故事。</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-6">
                    {project.data.pages.map((page) => (
                      <article
                        key={page.id}
                        className="relative overflow-hidden rounded-2xl border bg-card"
                      >
                        <Link
                          to="/projects/$projectId/pages/$pageId"
                          params={{ projectId, pageId: page.id }}
                          search={{}}
                          className="block focus-visible:outline-2 focus-visible:outline-ring"
                        >
                          <div className="flex h-36 items-center justify-center overflow-hidden bg-project-paper">
                            {page.coverSha256 ? (
                              <img
                                alt=""
                                className="size-full object-cover"
                                src={`frame-project://${projectId}/media/${page.coverSha256}`}
                              />
                            ) : (
                              <FileImage aria-hidden className="size-8 text-project-paper-icon" />
                            )}
                          </div>
                          <div className="p-4 pr-12">
                            <h2 className="truncate font-medium">{page.name}</h2>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {new Date(page.createdAt).toLocaleDateString('zh-CN')}
                            </p>
                          </div>
                        </Link>
                        <div className="absolute right-2 bottom-4">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                aria-label={`${page.name} 的菜单`}
                              >
                                <MoreHorizontal aria-hidden />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                onSelect={() => setAction({ kind: 'rename-page', projectId, page })}
                              >
                                重命名
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                variant="destructive"
                                onSelect={() => setAction({ kind: 'delete-page', projectId, page })}
                              >
                                删除
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </TabsContent>
              <TabsContent value="assets" forceMount hidden={tab !== 'assets'}>
                <ProjectAssets
                  client={engineClient}
                  projectId={projectId}
                  path={path}
                  onPathChange={(nextPath) =>
                    void navigate({
                      to: '/projects/$projectId',
                      params: { projectId },
                      search: (previous) => ({ ...previous, tab: 'assets', path: nextPath }),
                    })
                  }
                />
              </TabsContent>
            </Tabs>
          </>
        )
      )}
      {action && <ProjectDialog action={action} onClose={() => setAction(null)} />}
    </section>
  );
}
