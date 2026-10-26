import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useRouteContext } from '@tanstack/react-router';
import { z } from 'zod';
import { Folder, Info } from 'lucide-react';
import {
  GenerationJob,
  GenerationJobList,
  ProjectManifest,
  ProjectMutationResult,
  ProjectName,
  ProjectPageSummary,
  ProjectSummary,
  type ProjectSummary as Summary,
} from '@frame-loom/contracts';
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
import { pickDirectory, setPreferences, trashProject } from '@/lib/desktop-bridge';
import { preferencesQuery } from '@/lib/project-queries';

export type ProjectAction =
  | { kind: 'create' | 'open' }
  | { kind: 'rename' | 'delete' | 'cleanup' | 'relocate'; project: Summary }
  | { kind: 'create-page'; projectId: string }
  | { kind: 'rename-page' | 'delete-page'; projectId: string; page: ProjectPageSummary };
const titles = {
  create: '新建本地项目',
  open: '打开已有项目',
  rename: '重命名项目',
  delete: '删除项目',
  cleanup: '清理未使用媒体',
  relocate: '重新定位项目',
  'create-page': '新建创作页',
  'rename-page': '重命名创作页',
  'delete-page': '删除创作页',
};
const CleanupResult = z.object({ files: z.number(), bytes: z.number(), skipped: z.boolean() });

export function ProjectDialog({ action, onClose }: { action: ProjectAction; onClose: () => void }) {
  const { engineClient } = useRouteContext({ from: '__root__' });
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const preferences = useQuery(preferencesQuery());
  const [name, setName] = useState(
    'project' in action ? action.project.name : 'page' in action ? action.page.name : '',
  );
  const [location, setLocation] = useState('');
  const [asCopy, setAsCopy] = useState(false);
  const [trash, setTrash] = useState(
    !('project' in action) || action.project.status === 'available',
  );
  const [cancelJobs, setCancelJobs] = useState(false);
  const [pickerError, setPickerError] = useState('');
  const busyPicker = useRef(false);
  const opener = useRef(document.activeElement);
  const [picking, setPicking] = useState(false);
  const [trashed, setTrashed] = useState(false);
  const needsName =
    ['create', 'rename', 'create-page', 'rename-page'].includes(action.kind) ||
    (action.kind === 'open' && (asCopy || name.length > 0));
  const parsedName = ProjectName.safeParse(name);
  const nameError = needsName && !parsedName.success ? parsedName.error.issues[0].message : '';
  const root =
    location || (action.kind === 'create' ? (preferences.data?.projectLocation ?? '') : '');
  const jobs = useQuery({
    queryKey: ['generation-jobs', 'project-delete'],
    queryFn: ({ signal }) =>
      engineClient.request('/generation-jobs', GenerationJobList, { signal }),
    enabled: action.kind === 'delete',
    refetchInterval: 2000,
  });
  const activeJobs = (jobs.data ?? []).filter(
    (job) =>
      'project' in action &&
      job.request.projectId === action.project.id &&
      !['succeeded', 'failed', 'cancelled'].includes(job.status),
  );
  const cleanup = useQuery({
    queryKey: ['projects', 'cleanup', 'project' in action ? action.project.id : ''],
    queryFn: () =>
      engineClient.request(
        `/projects/${'project' in action ? action.project.id : ''}/media/cleanup?dryRun=true`,
        CleanupResult,
        { method: 'POST' },
      ),
    enabled: action.kind === 'cleanup',
  });
  const mutation = useMutation({
    mutationFn: async () => {
      const id =
        'project' in action ? action.project.id : 'projectId' in action ? action.projectId : '';
      switch (action.kind) {
        case 'create': {
          const project = await engineClient.request('/projects', ProjectSummary, {
            method: 'POST',
            body: { name, location: root },
          });
          try {
            const value = await setPreferences({ projectLocation: root });
            queryClient.setQueryData(preferencesQuery().queryKey, value);
          } catch {
            // 项目已创建；偏好失败不让重试重复创建，仍允许从下次对话框重新选位置。
            await queryClient.invalidateQueries({ queryKey: ['preferences'] });
          }
          return project.id;
        }
        case 'open':
          return (
            await engineClient.request('/projects/open', ProjectSummary, {
              method: 'POST',
              body: { rootPath: root, asCopy, ...(name.trim() ? { name } : {}) },
            })
          ).id;
        case 'relocate':
          await engineClient.request(`/projects/${id}/relocate`, ProjectSummary, {
            method: 'POST',
            body: { rootPath: root },
          });
          break;
        case 'rename':
          await engineClient.request(`/projects/${id}`, ProjectManifest, {
            method: 'PATCH',
            body: { name },
          });
          break;
        case 'delete':
          if (cancelJobs)
            for (const job of activeJobs)
              await engineClient.request(`/generation-jobs/${job.id}/cancel`, GenerationJob, {
                method: 'POST',
              });
          if (trash && !trashed) {
            await trashProject({ projectId: id });
            setTrashed(true);
          }
          await engineClient.request(`/projects/${id}`, ProjectMutationResult, {
            method: 'DELETE',
          });
          break;
        case 'cleanup': {
          const result = await engineClient.request(
            `/projects/${id}/media/cleanup?dryRun=false`,
            CleanupResult,
            { method: 'POST' },
          );
          if (result.skipped) throw new Error('项目正在编辑，请关闭创作页后重试');
          break;
        }
        case 'create-page': {
          const page = await engineClient.request(`/projects/${id}/pages`, ProjectPageSummary, {
            method: 'POST',
            body: { name },
          });
          await navigate({
            to: '/projects/$projectId/pages/$pageId',
            params: { projectId: id, pageId: page.id },
            search: {},
          });
          break;
        }
        case 'rename-page':
          await engineClient.request(
            `/projects/${id}/pages/${action.page.id}`,
            ProjectPageSummary,
            { method: 'PATCH', body: { name } },
          );
          break;
        case 'delete-page':
          await engineClient.request(
            `/projects/${id}/pages/${action.page.id}`,
            ProjectMutationResult,
            { method: 'DELETE' },
          );
          break;
      }
      return undefined;
    },
    onSuccess: async (projectId) => {
      await queryClient.invalidateQueries({ queryKey: ['projects'] });
      if (projectId)
        await navigate({
          to: '/projects/$projectId',
          params: { projectId },
          search: { tab: 'pages', path: '' },
        });
      onClose();
    },
  });
  const busy = mutation.isPending || picking;
  const canSubmit =
    !busy &&
    !nameError &&
    (!['create', 'open', 'relocate'].includes(action.kind) || !!root) &&
    (action.kind !== 'create' || !!preferences.data) &&
    (action.kind !== 'delete' || (!!jobs.data && !jobs.error)) &&
    (action.kind !== 'cleanup' || (!!cleanup.data && !cleanup.data.skipped && !cleanup.error));
  const error = pickerError || mutation.error?.message;
  async function selectDirectory() {
    if (busyPicker.current) return;
    busyPicker.current = true;
    setPicking(true);
    setPickerError('');
    try {
      const directory = await pickDirectory(root ? { defaultPath: root } : {});
      if (directory) setLocation(directory);
    } catch (error) {
      setPickerError(error instanceof Error ? error.message : '无法选择目录');
    } finally {
      busyPicker.current = false;
      setPicking(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent
        className="max-h-[calc(100dvh-3rem)] overflow-y-auto rounded-3xl bg-card p-7 shadow-panel"
        showCloseButton={!busy}
        onCloseAutoFocus={(event) => {
          if (opener.current instanceof HTMLElement && opener.current.isConnected) {
            event.preventDefault();
            opener.current.focus();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>{titles[action.kind]}</DialogTitle>
          <DialogDescription className="break-all">
            {action.kind === 'create'
              ? '为灵感建立一个本地空间，创作页与素材都保存在项目文件夹中。'
              : 'project' in action
                ? action.project.rootPath
                : '一张创作页对应一张独立画布。'}
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid min-w-0 gap-5"
          onSubmit={(event) => {
            event.preventDefault();
            if (canSubmit) mutation.mutate();
          }}
        >
          {(needsName || action.kind === 'open') && (
            <div className="grid gap-2">
              <label htmlFor="project-name">
                {action.kind.includes('page')
                  ? '创作页名称'
                  : action.kind === 'open'
                    ? '项目名称（可选，重名时修改）'
                    : '项目名称'}
              </label>
              <Input
                id="project-name"
                autoFocus
                value={name}
                disabled={busy}
                onChange={(event) => {
                  setName(event.target.value);
                  mutation.reset();
                }}
                aria-invalid={!!nameError || !!mutation.error}
                aria-describedby="project-name-error"
                placeholder="例如：城市漫游"
              />
              <p
                id="project-name-error"
                className="text-xs text-destructive"
                role={nameError && name ? 'alert' : undefined}
              >
                {(name && nameError) || error}
              </p>
            </div>
          )}
          {['create', 'open', 'relocate'].includes(action.kind) && (
            <div className="grid min-w-0 gap-2">
              <span>{action.kind === 'create' ? '保存位置' : '项目文件夹'}</span>
              <div className="flex min-w-0 items-center gap-2 rounded-xl border bg-muted p-3">
                <Folder aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate text-xs" title={root}>
                  {root || '请选择包含 .frameloom 的项目文件夹'}
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => void selectDirectory()}
                >
                  更改
                </Button>
              </div>
            </div>
          )}
          {action.kind === 'create' && (
            <p className="flex gap-2 rounded-xl bg-muted p-3 text-xs text-muted-foreground">
              <Info aria-hidden className="size-4 shrink-0" />
              本地文件夹是项目的完整副本，请勿删除其中的 .frameloom 数据。
            </p>
          )}
          {action.kind === 'open' && (
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={asCopy}
                disabled={busy}
                onChange={(event) => setAsCopy(event.target.checked)}
              />
              作为副本打开（重置所选文件夹的项目身份）
            </label>
          )}
          {action.kind === 'delete' && (
            <>
              <p className="break-words">确定删除「{action.project.name}」？</p>
              <fieldset disabled={busy || trashed} className="grid gap-3">
                <legend className="sr-only">删除去向</legend>
                <label className="flex items-start gap-2">
                  <input
                    type="radio"
                    name="delete-target"
                    disabled={action.project.status !== 'available'}
                    checked={trash}
                    onChange={() => setTrash(true)}
                  />
                  同时将项目文件夹移到回收站
                </label>
                <label className="flex items-start gap-2">
                  <input
                    type="radio"
                    name="delete-target"
                    checked={!trash}
                    onChange={() => setTrash(false)}
                  />
                  仅从项目库移除
                </label>
              </fieldset>
              {jobs.isPending ? (
                <p>正在检查生成任务…</p>
              ) : jobs.error ? (
                <p role="alert">无法检查任务：{jobs.error.message}</p>
              ) : (
                activeJobs.length > 0 && (
                  <div className="grid gap-2 rounded-xl bg-muted p-3">
                    <p>有 {activeJobs.length} 个未结束任务，远端可能仍在运行并计费。</p>
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={cancelJobs}
                        disabled={busy}
                        onChange={(event) => setCancelJobs(event.target.checked)}
                      />
                      同时放弃这些任务
                    </label>
                  </div>
                )
              )}
              {trashed && <p>文件夹已移到回收站，请重试移除项目库记录。</p>}
            </>
          )}
          {action.kind === 'delete-page' && (
            <p>「{action.page.name}」将移入项目回收区，保留 30 天。本期尚无恢复界面。</p>
          )}
          {action.kind === 'cleanup' && (
            <p>
              {cleanup.isPending
                ? '正在统计未使用媒体…'
                : cleanup.error
                  ? cleanup.error.message
                  : cleanup.data?.skipped
                    ? '项目正在编辑，请关闭创作页后重试。'
                    : `将永久删除 ${cleanup.data?.files ?? 0} 个文件，释放 ${((cleanup.data?.bytes ?? 0) / 1024 / 1024).toFixed(2)} MiB，无法撤销。`}
            </p>
          )}
          {!needsName && error && (
            <p role="alert" className="text-destructive">
              {error}
            </p>
          )}
          <DialogFooter className="flex-row justify-end">
            <Button
              type="button"
              variant="ghost"
              className="rounded-full"
              disabled={busy}
              onClick={onClose}
            >
              取消
            </Button>
            <Button
              type="submit"
              className="rounded-full"
              variant={
                ['delete', 'delete-page', 'cleanup'].includes(action.kind)
                  ? 'destructive'
                  : 'default'
              }
              disabled={!canSubmit}
            >
              {mutation.isPending ? '处理中…' : action.kind === 'create' ? '创建项目' : '确认'}
            </Button>
          </DialogFooter>
        </form>
        {preferences.error && action.kind === 'create' && (
          <p role="alert" className="text-destructive">
            无法读取保存位置：{preferences.error.message}
            <Button variant="ghost" onClick={() => void preferences.refetch()}>
              重试
            </Button>
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
