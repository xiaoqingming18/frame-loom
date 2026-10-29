import { Link } from '@tanstack/react-router';
import { Clapperboard, LoaderCircle, MoreHorizontal } from 'lucide-react';
import type { EpisodeResult } from '@frame-loom/contracts';
import { Button } from '@frame-loom/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@frame-loom/ui/components/dropdown-menu';
import type { EpisodeAction } from './episode-dialog';

function episodeStatus(episode: EpisodeResult): string {
  const status = episode.conversion?.status;
  return status === 'queued'
    ? '排队中'
    : status === 'running'
      ? '转换中'
      : status === 'failed'
        ? '转换失败'
        : episode.draft
          ? '导入未完成'
          : episode.chars || episode.scenes
            ? '已结构化'
            : '空';
}
export function EpisodeList({
  projectId,
  episodes,
  onAction,
  onCreatePage,
}: {
  projectId: string;
  episodes: EpisodeResult[];
  onAction: (action: EpisodeAction) => void;
  onCreatePage: (episodeId: string) => void;
}) {
  if (!episodes.length)
    return (
      <div className="grid min-h-60 place-content-center gap-3 text-center">
        <Clapperboard aria-hidden className="mx-auto size-10 text-project-paper-icon" />
        <h2>还没有剧集</h2>
        <p className="text-sm text-muted-foreground">
          新建第一集，粘贴剧本即可自动拆分场次并提取人物、场景
        </p>
      </div>
    );
  return (
    <div className="overflow-x-auto rounded-xl border bg-card">
      <table className="w-full text-left text-sm">
        <thead className="border-b bg-muted text-xs text-muted-foreground">
          <tr>
            {['集号', '标题', '剧本状态', '场次', '字数', '待确认', '更新时间', '操作'].map(
              (label) => (
                <th key={label} className="px-3 py-3 font-medium whitespace-nowrap">
                  {label}
                </th>
              ),
            )}
          </tr>
        </thead>
        <tbody>
          {episodes.map((episode) => (
            <tr key={episode.id} className="border-b last:border-0 hover:bg-accent">
              <td className="px-3 py-4 whitespace-nowrap">
                <Link
                  to="/projects/$projectId/episodes/$episodeId"
                  params={{ projectId, episodeId: episode.id }}
                  search={{}}
                >
                  第 {episode.number} 集
                </Link>
              </td>
              <td className="max-w-48 truncate px-3">
                <Link
                  to="/projects/$projectId/episodes/$episodeId"
                  params={{ projectId, episodeId: episode.id }}
                  search={{}}
                >
                  {episode.title || '未命名'}
                </Link>
              </td>
              <td className="px-3 whitespace-nowrap">
                {episode.conversion?.status === 'running' && (
                  <LoaderCircle aria-hidden className="mr-1 inline size-3 animate-spin" />
                )}
                {episodeStatus(episode)}
              </td>
              <td className="px-3">{episode.scenes}</td>
              <td className="px-3">{episode.chars}</td>
              <td className="px-3">
                <span className="rounded-full bg-muted px-2 py-1 text-warning">
                  {episode.pending}
                </span>
              </td>
              <td className="px-3 text-xs whitespace-nowrap text-muted-foreground">
                {new Date(episode.updatedAt).toLocaleDateString('zh-CN')}
              </td>
              <td className="px-2">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`第 ${episode.number} 集的菜单`}
                    >
                      <MoreHorizontal aria-hidden />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => onAction({ kind: 'edit', episode })}>
                      修改集号和标题
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => onCreatePage(episode.id)}>
                      在本集新建创作页
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      variant="destructive"
                      onSelect={() => onAction({ kind: 'delete', episode })}
                    >
                      删除
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
