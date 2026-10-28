import { useRef, useState } from 'react';
import { CircleHelp } from 'lucide-react';
import { MEDIA_ROLE_LABELS, type CanvasMediaData, type SemanticInput } from '@frame-loom/contracts';
import { Button } from '@frame-loom/ui/components/button';
import { NativeSelect } from '@frame-loom/ui/components/native-select';
import { Popover, PopoverContent, PopoverTrigger } from '@frame-loom/ui/components/popover';
import { useCanvas, useCanvasState } from '../context';
import { isNodeLocked, updateData } from '../commands/commands';
import { generationSources } from './generation-inputs';
import type { CanvasGenerationModel } from '../host';
import { videoInputs } from './media';
import { referenceRoleReason, referenceCandidateIssue } from './reference-check';

const roles = MEDIA_ROLE_LABELS;

export function VideoReferences({
  nodeId,
  data,
  model,
  disabled,
}: {
  nodeId: string;
  data: CanvasMediaData;
  model: CanvasGenerationModel;
  disabled: boolean;
}) {
  const { host, store } = useCanvas();
  const document = useCanvasState((state) => state.document);
  const refs = generationSources(document, nodeId);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const role = useRef<SemanticInput['role']>('reference');
  const capability = model.capability;
  const ports = capability.kind === 'video' ? videoInputs(data, capability) : [];
  const reason = (value: SemanticInput['role'], kind: SemanticInput['kind']) =>
    referenceRoleReason(model, data, value, kind);
  function reorder(index: number, offset: number) {
    const order = refs.map((ref) => ref.id);
    if (index + offset < 0 || index + offset >= order.length) return;
    order.splice(index + offset, 0, order.splice(index, 1)[0]);
    store.getState().apply((document) =>
      updateData<CanvasMediaData>(document, nodeId, (current) => ({
        ...current,
        inputOrder: order,
      })),
    );
  }
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          aria-label="视频素材"
          size="sm"
          variant="ghost"
          className="h-8 shrink-0 px-1 text-xs"
          disabled={disabled}
        >
          管理素材
        </Button>
      </PopoverTrigger>
      <PopoverContent
        aria-label="视频素材"
        side="top"
        sticky="always"
        onKeyDown={(event) => event.stopPropagation()}
        className="nodrag nopan nowheel max-h-[min(440px,var(--radix-popover-content-available-height))] w-96 max-w-[calc(100vw-32px)] overflow-y-auto text-xs"
      >
        <div className="mb-3 flex items-center justify-between">
          <h3>视频素材</h3>
          <Popover>
            <PopoverTrigger asChild>
              <Button size="icon" variant="ghost" aria-label="视频素材说明" className="size-6">
                <CircleHelp aria-hidden="true" className="size-3.5" />
              </Button>
            </PopoverTrigger>
            <PopoverContent sticky="always" className="max-w-[calc(100vw-32px)] text-xs">
              可上传本地图片、视频、音频，或连接画布节点。可用角色及混合方式由模型能力卡决定；切换方式或模型保留素材，处理不兼容项后才能生成。编号、排序和请求一致。上传只存入项目，不调用模型。
            </PopoverContent>
          </Popover>
        </div>
        <input
          ref={fileInput}
          aria-label="上传视频参考素材"
          type="file"
          className="hidden"
          accept={
            capability.kind === 'video'
              ? Object.values(capability.references)
                  .flatMap((limit) => (typeof limit === 'object' ? (limit.formats ?? []) : []))
                  .map((format) => (format.includes('/') ? format : `.${format}`))
                  .join(',')
              : ''
          }
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (!file || uploading || disabled) return;
            const selectedRole = role.current;
            const kind = file.type.startsWith('image/')
              ? ('image' as const)
              : file.type.startsWith('video/')
                ? ('video' as const)
                : ('audio' as const);
            const candidate = {
              input: { role: selectedRole, kind, order: refs.length, sha256: '0'.repeat(64) },
              media: { mime: file.type, bytes: file.size },
            };
            const issue = referenceCandidateIssue(model, data, refs, candidate);
            if (issue) {
              store.getState().notify(issue);
              return;
            }
            setUploading(true);
            void host.media
              .upload(file)
              .then((media) => {
                const state = store.getState();
                const node = state.document.nodes.find((node) => node.id === nodeId);
                if (!node || isNodeLocked(state.document, node)) return;
                const id = crypto.randomUUID();
                const currentRefs = generationSources(state.document, nodeId);
                const issue = referenceCandidateIssue(
                  model,
                  node.data as CanvasMediaData,
                  currentRefs,
                  {
                    input: {
                      role: selectedRole,
                      kind,
                      order: currentRefs.length,
                      sha256: media.sha256,
                    },
                    media,
                  },
                );
                if (issue) {
                  state.notify(issue);
                  return;
                }
                state.apply((document) =>
                  updateData<CanvasMediaData>(document, nodeId, (current) => ({
                    ...current,
                    mediaReferences: [
                      ...(current.mediaReferences ?? []),
                      { id, name: file.name.slice(0, 200), role: selectedRole, media },
                    ],
                    inputOrder: [...generationSources(document, nodeId).map((ref) => ref.id), id],
                  })),
                );
              })
              .catch((error: unknown) =>
                store.getState().notify(error instanceof Error ? error.message : '上传素材失败'),
              )
              .finally(() => setUploading(false));
          }}
        />
        <div className="mb-3 flex flex-wrap gap-1">
          {Object.entries(roles)
            .filter(([key]) => ports.some((port) => port.id === key))
            .map(([key, name]) => {
              const inputRole = key as SemanticInput['role'];
              const blocked = (['image', 'video', 'audio'] as const).every((kind) =>
                reason(inputRole, kind),
              )
                ? '当前方式不支持该角色'
                : undefined;
              return (
                <Button
                  key={key}
                  variant="outline"
                  size="sm"
                  disabled={disabled || uploading || !!blocked || refs.length >= 50}
                  aria-describedby={`role-help-${nodeId}-${key}`}
                  onClick={() => {
                    role.current = inputRole;
                    fileInput.current?.click();
                  }}
                >
                  上传{name}
                </Button>
              );
            })}
          {Object.entries(roles).map(([key]) => (
            <span key={key} id={`role-help-${nodeId}-${key}`} className="sr-only">
              {reason(key as SemanticInput['role'], 'image')}
            </span>
          ))}
        </div>
        <div className="space-y-3">
          {refs.map((ref, index) => {
            const blocked = reason(ref.input.role, ref.input.kind);
            return (
              <section
                key={ref.id}
                aria-label={`素材 ${index + 1}`}
                className="space-y-1 border-t pt-2"
              >
                <p className="truncate">
                  {index + 1}. {ref.name} ·{' '}
                  {ref.input.kind === 'image'
                    ? '图片'
                    : ref.input.kind === 'video'
                      ? '视频'
                      : '音频'}
                </p>
                <div className="flex flex-wrap items-center gap-1">
                  <NativeSelect
                    aria-label={`素材 ${index + 1} 角色`}
                    value={ref.input.role}
                    disabled={disabled}
                    className="h-8 w-auto text-xs"
                    onChange={(event) => {
                      const next = event.target.value as SemanticInput['role'];
                      store.getState().apply((document) => ({
                        ...updateData<CanvasMediaData>(document, nodeId, (current) => ({
                          ...current,
                          mediaReferences: current.mediaReferences?.map((item) =>
                            item.id === ref.id ? { ...item, role: next } : item,
                          ),
                        })),
                        edges: document.edges.map((edge) =>
                          edge.id === ref.id ? { ...edge, targetHandle: next } : edge,
                        ),
                      }));
                    }}
                  >
                    {Object.entries(roles).map(([key, name]) => (
                      <option
                        key={key}
                        value={key}
                        disabled={!!reason(key as SemanticInput['role'], ref.input.kind)}
                      >
                        {name}
                      </option>
                    ))}
                  </NativeSelect>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`素材 ${index + 1} 前移`}
                    disabled={disabled || index === 0}
                    onClick={() => reorder(index, -1)}
                  >
                    前移
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`素材 ${index + 1} 后移`}
                    disabled={disabled || index === refs.length - 1}
                    onClick={() => reorder(index, 1)}
                  >
                    后移
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`移除素材 ${index + 1}`}
                    disabled={disabled}
                    onClick={() =>
                      store.getState().apply((document) => ({
                        ...updateData<CanvasMediaData>(document, nodeId, (current) => ({
                          ...current,
                          mediaReferences: current.mediaReferences?.filter(
                            (item) => item.id !== ref.id,
                          ),
                          inputOrder: current.inputOrder.filter((id) => id !== ref.id),
                        })),
                        edges: document.edges.filter((edge) => edge.id !== ref.id),
                      }))
                    }
                  >
                    移除
                  </Button>
                </div>
                {blocked && (
                  <p role="alert" className="text-destructive">
                    {blocked}
                  </p>
                )}
              </section>
            );
          })}
          {!refs.length && (
            <p className="text-muted-foreground">尚无素材；按模式添加素材或连接画布节点。</p>
          )}
          {capability.kind === 'video' &&
            (['image', 'video', 'audio'] as const).map((kind) => {
              const limit = capability.references[kind];
              return limit ? (
                <p key={kind} className="text-muted-foreground">
                  {kind === 'image' ? '图片' : kind === 'video' ? '视频' : '音频'}最多{' '}
                  {limit.max ?? '不限'} 个
                  {limit.maxBytes !== undefined
                    ? ` · 每个 ≤ ${Math.round(limit.maxBytes / 1024 / 1024)} MB`
                    : ''}
                  {limit.maxTotalSec !== undefined ? ` · 总时长 ≤ ${limit.maxTotalSec} 秒` : ''}
                </p>
              ) : null;
            })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
