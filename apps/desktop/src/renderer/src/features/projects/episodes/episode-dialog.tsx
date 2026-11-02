import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useRouteContext } from '@tanstack/react-router';
import { EpisodeSummary, ProjectMutationResult, type EpisodeResult } from '@frame-loom/contracts';
import { Button } from '@frame-loom/ui/components/button';
import { Input } from '@frame-loom/ui/components/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@frame-loom/ui/components/dialog';

export type EpisodeAction = { kind: 'create' | 'edit' | 'delete'; episode?: EpisodeResult };
export function EpisodeDialog({
  projectId,
  episodes,
  action,
  onClose,
}: {
  projectId: string;
  episodes: EpisodeResult[];
  action: EpisodeAction;
  onClose: () => void;
}) {
  const { engineClient } = useRouteContext({ from: '__root__' });
  const cache = useQueryClient();
  const navigate = useNavigate();
  const [number, setNumber] = useState(
    action.episode?.number ?? Math.max(0, ...episodes.map((episode) => episode.number)) + 1,
  );
  const [title, setTitle] = useState(action.episode?.title ?? '');
  const [duration, setDuration] = useState(action.episode?.duration_sec ?? 0);
  const duplicate = episodes.some(
    (episode) => episode.number === number && episode.id !== action.episode?.id,
  );
  const mutation = useMutation({
    mutationFn: async () => {
      const url = `/projects/${projectId}/episodes`;
      if (action.kind === 'delete') {
        await engineClient.request(`${url}/${action.episode!.id}`, ProjectMutationResult, {
          method: 'DELETE',
        });
        return;
      }
      return engineClient.request(
        action.kind === 'edit' ? `${url}/${action.episode!.id}` : url,
        EpisodeSummary,
        {
          method: action.kind === 'edit' ? 'PATCH' : 'POST',
          body: { number, title, duration_sec: duration },
        },
      );
    },
    onSuccess: async (episode) => {
      await cache.invalidateQueries({ queryKey: ['projects', projectId] });
      if (action.kind === 'create' && episode)
        await navigate({
          to: '/projects/$projectId/episodes/$episodeId',
          params: { projectId, episodeId: episode.id },
          search: {},
        });
      onClose();
    },
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !mutation.isPending) onClose();
      }}
    >
      <DialogContent className="rounded-3xl">
        <DialogHeader>
          <DialogTitle>
            {action.kind === 'create'
              ? '新建剧集'
              : action.kind === 'edit'
                ? '修改剧集'
                : '删除剧集'}
          </DialogTitle>
          <DialogDescription>
            {action.kind === 'delete'
              ? '剧本将移入项目回收区保留 30 天，所属创作页保留并改为未分集'
              : '为每一集组织剧本与创作页。'}
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (
              action.kind === 'delete' ||
              (!duplicate &&
                Number.isInteger(number) &&
                number >= 1 &&
                number <= 9999 &&
                Number.isInteger(duration) &&
                duration >= 0)
            )
              mutation.mutate();
          }}
        >
          {action.kind !== 'delete' && (
            <>
              <label className="grid gap-2">
                集号
                <Input
                  type="number"
                  min={1}
                  max={9999}
                  autoFocus
                  value={number}
                  onChange={(event) => {
                    setNumber(Number(event.target.value));
                    mutation.reset();
                  }}
                  aria-describedby="episode-number-error"
                />
              </label>
              <p
                id="episode-number-error"
                role={duplicate || mutation.error ? 'alert' : undefined}
                className="text-xs text-destructive"
              >
                {duplicate ? '集号已存在' : mutation.error?.message}
              </p>
              <label className="grid gap-2">
                标题（选填）
                <Input
                  value={title}
                  maxLength={80}
                  onChange={(event) => setTitle(event.target.value)}
                />
              </label>
              <label className="grid gap-2">
                单集时长（秒，0 表示未填写）
                <Input
                  type="number"
                  min={0}
                  step={1}
                  value={duration}
                  onChange={(event) => setDuration(Number(event.target.value))}
                />
              </label>
            </>
          )}
          {action.kind === 'delete' && mutation.error && (
            <p role="alert">{mutation.error.message}</p>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={mutation.isPending}>
              取消
            </Button>
            <Button
              type="submit"
              variant={action.kind === 'delete' ? 'destructive' : 'default'}
              disabled={
                mutation.isPending ||
                (action.kind !== 'delete' &&
                  (duplicate ||
                    number < 1 ||
                    number > 9999 ||
                    !Number.isInteger(number) ||
                    !Number.isInteger(duration) ||
                    duration < 0))
              }
            >
              {mutation.isPending ? '处理中…' : '确认'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
