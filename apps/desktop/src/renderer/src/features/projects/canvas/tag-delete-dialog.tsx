import { useState } from 'react';
import { LockKeyhole } from 'lucide-react';
import type { ProjectTag, ProjectTagUsage } from '@frame-loom/contracts';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@frame-loom/ui/components/dialog';
import { Button } from '@frame-loom/ui/components/button';
import { NativeSelect } from '@frame-loom/ui/components/native-select';

type TagReassign = { pageId: string; nodeId: string; tagId: string | null };

export function TagDeleteDialog({
  projectId,
  tag,
  tags,
  usages,
  loading,
  error,
  onCancel,
  onConfirm,
}: {
  projectId: string;
  tag: ProjectTag;
  tags: ProjectTag[];
  usages: ProjectTagUsage[];
  loading: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: (reassign: TagReassign[]) => void;
}) {
  const [targets, setTargets] = useState<Record<string, string>>({});
  const options = tags.filter((item) => item.id !== tag.id);
  const key = (usage: ProjectTagUsage) => `${usage.pageId}:${usage.nodeId}`;
  const complete = usages.every((usage) => {
    const target = targets[key(usage)];
    return target === '__none' || options.some((item) => item.id === target);
  });
  const assignAll = (tagId: string) =>
    setTargets(Object.fromEntries(usages.map((usage) => [key(usage), tagId])));
  return (
    <Dialog open onOpenChange={(open) => !open && !loading && onCancel()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>删除标签「{tag.name}」</DialogTitle>
          <DialogDescription>
            {usages.length ? '请为每个引用选择新的标签或无标签。' : '删除后不可恢复。'}
          </DialogDescription>
        </DialogHeader>
        {usages.length > 0 && (
          <>
            <label className="flex items-center gap-2 text-sm">
              全部改为
              <NativeSelect
                disabled={loading}
                aria-label="全部改为"
                className="w-auto"
                value=""
                onChange={(event) => assignAll(event.target.value)}
              >
                <option value="" disabled>
                  选择标签
                </option>
                <option value="__none">无标签</option>
                {options.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </NativeSelect>
            </label>
            <ul className="max-h-80 space-y-2 overflow-y-auto">
              {usages.map((usage) => (
                <li key={key(usage)} className="flex items-center gap-3 border-b pb-2">
                  {usage.thumbnailSha256 ? (
                    <img
                      className="size-12 rounded-sm object-cover"
                      src={`frame-project://${projectId}/media/${usage.thumbnailSha256}`}
                      alt=""
                    />
                  ) : (
                    <div className="size-12 rounded-sm bg-muted" aria-hidden />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm">{usage.title || '未命名节点'}</div>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      {usage.locked && (
                        <span role="img" aria-label="已锁定">
                          <LockKeyhole aria-hidden="true" className="size-3.5" />
                        </span>
                      )}
                      <span>{usage.pageName}</span>
                    </div>
                  </div>
                  <NativeSelect
                    disabled={loading}
                    aria-label={`${usage.title || '未命名节点'}的改派标签`}
                    className="w-auto max-w-40 shrink-0"
                    value={targets[key(usage)] ?? ''}
                    onChange={(event) =>
                      setTargets((current) => ({ ...current, [key(usage)]: event.target.value }))
                    }
                  >
                    <option value="" disabled>
                      选择标签
                    </option>
                    <option value="__none">无标签</option>
                    {options.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </NativeSelect>
                </li>
              ))}
            </ul>
          </>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" disabled={loading} onClick={onCancel}>
            取消
          </Button>
          <Button
            variant="destructive"
            disabled={loading || !complete}
            onClick={() =>
              onConfirm(
                usages.map((usage) => ({
                  pageId: usage.pageId,
                  nodeId: usage.nodeId,
                  tagId: targets[key(usage)] === '__none' ? null : targets[key(usage)],
                })),
              )
            }
          >
            删除标签
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
