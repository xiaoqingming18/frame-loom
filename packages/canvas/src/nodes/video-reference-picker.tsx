import { useState } from 'react';
import { ArrowLeftRight, Plus } from 'lucide-react';
import {
  checkGenerationMedia,
  generationRoleReason,
  type CanvasDocument,
  type CanvasMediaData,
  type GenerationInput,
  type GenerationRequest,
  type ModelProfile,
} from '@frame-loom/contracts';
import { Button } from '@frame-loom/ui/components/button';
import { Popover, PopoverContent, PopoverTrigger } from '@frame-loom/ui/components/popover';
import { useCanvas, useCanvasState } from '../context';
import { connect, isNodeLocked, updateData } from '../commands/commands';
import type { NodeRegistry } from '../registry/registry';
import { checkConnection } from '../registry/connections';
import { generationSources } from './generation-inputs';
import { activeVersion } from './media';

type Role = GenerationInput['role'];

function removeVideoReferences(document: CanvasDocument, nodeId: string, ids: string[]) {
  return {
    ...updateData<CanvasMediaData>(document, nodeId, (data) => ({
      ...data,
      mediaReferences: data.mediaReferences?.filter((ref) => !ids.includes(ref.id)),
      inputOrder: data.inputOrder.filter((id) => !ids.includes(id)),
    })),
    edges: document.edges.filter((edge) => !ids.includes(edge.id)),
  };
}

function roleReferences(document: CanvasDocument, nodeId: string, role: Role) {
  return [
    ...generationSources(document, nodeId)
      .filter((ref) => ref.input.role === role)
      .map((ref) => ref.id),
    ...document.edges
      .filter((edge) => edge.target === nodeId && edge.targetHandle === role)
      .map((edge) => edge.id),
  ];
}

function videoReferenceCandidates(
  registry: NodeRegistry,
  document: CanvasDocument,
  nodeId: string,
  profile: ModelProfile,
  role: Role,
) {
  const target = document.nodes.find((node) => node.id === nodeId);
  if (!target || isNodeLocked(document, target)) return [];
  const data = target.data as CanvasMediaData;
  const replaced = role === 'reference' ? [] : roleReferences(document, nodeId, role);
  const base = removeVideoReferences(document, nodeId, replaced);
  const refs = generationSources(base, nodeId);
  return document.nodes.flatMap((node) => {
    if (!['image', 'video'].includes(node.type) || !registry.supports(node)) return [];
    const media = activeVersion(node.data as CanvasMediaData);
    if (!media) return [];
    const input: GenerationInput = {
      kind: node.type as 'image' | 'video',
      role,
      sha256: media.sha256,
    };
    const request: GenerationRequest = {
      modelId: data.modelId ?? '',
      mode: data.mode ?? 'text',
      prompt: data.prompt,
      params: data.params ?? {},
      inputs: [...refs.map((ref) => ref.input), input],
      source: 'canvas',
    };
    if (
      generationRoleReason(profile, request, role, input.kind) ||
      request.inputs.length > 50 ||
      request.inputs.filter((ref) => ref.kind === input.kind).length >
        (profile.inputs.find((limit) => limit.kind === input.kind)?.maxCount ?? 0) ||
      checkGenerationMedia(profile, [...refs, { input, media }]).some(
        (issue) => issue.field === 'inputs' || issue.field === `inputs.${refs.length}`,
      ) ||
      !checkConnection(registry, base, {
        source: node.id,
        sourceHandle: 'out',
        target: nodeId,
        targetHandle: role,
      }).ok
    )
      return [];
    return [{ node, media }];
  });
}

export function VideoReferencePicker({
  nodeId,
  profile,
  role,
  disabled,
}: {
  nodeId: string;
  profile: ModelProfile;
  role: Role;
  disabled: boolean;
}) {
  const { host, store, registry } = useCanvas();
  const document = useCanvasState((state) => state.document);
  const [open, setOpen] = useState(false);
  const refs = generationSources(document, nodeId).filter((ref) => ref.input.role === role);
  const current = role === 'reference' ? undefined : refs[0];
  const label = role === 'first_frame' ? '首帧' : role === 'last_frame' ? '尾帧' : '参考素材';
  const candidates = videoReferenceCandidates(registry, document, nodeId, profile, role);
  const target = document.nodes.find((node) => node.id === nodeId)?.data as
    CanvasMediaData | undefined;
  const request = {
    mode: target?.mode ?? 'text',
    params: target?.params ?? {},
    inputs: generationSources(document, nodeId).map((ref) => ref.input),
  };
  const blocked =
    role === 'reference'
      ? ['image', 'video'].every((kind) =>
          generationRoleReason(profile, request, role, kind as 'image' | 'video'),
        )
        ? '当前模型或模式不支持画布参考素材'
        : undefined
      : generationRoleReason(profile, request, role, 'image');
  const occupied = role !== 'reference' && roleReferences(document, nodeId, role).length > 0;
  return (
    <div className="flex shrink-0 flex-col items-center gap-1">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            disabled={disabled || (!!blocked && !occupied)}
            title={blocked}
            aria-label={`${occupied ? '替换' : '添加'}${label}`}
            className="size-12 overflow-hidden rounded-lg border border-dashed p-0 text-muted-foreground"
          >
            {current ? (
              <img
                src={host.media.url(current.input.sha256)}
                alt={label}
                className="size-full object-cover"
              />
            ) : (
              <Plus aria-hidden="true" className="size-4" />
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent
          aria-label={`选择${label}`}
          side="top"
          align="start"
          onKeyDown={(event) => event.stopPropagation()}
          className="nodrag nopan nowheel max-h-[min(360px,var(--radix-popover-content-available-height))] w-80 max-w-[calc(100vw-32px)] overflow-y-auto rounded-xl text-xs"
        >
          <h3 className="mb-3 text-muted-foreground">选择画布中的{label}</h3>
          <div className="grid grid-cols-3 gap-2">
            {candidates.map(({ node, media }) => (
              <Button
                key={node.id}
                variant="ghost"
                aria-label={`选择 ${node.title ?? node.id}`}
                className="h-auto min-w-0 flex-col gap-1 p-1"
                onClick={() => {
                  store.getState().apply((latest) => {
                    if (
                      !videoReferenceCandidates(registry, latest, nodeId, profile, role).some(
                        (item) => item.node.id === node.id,
                      )
                    )
                      return latest;
                    const old = role === 'reference' ? [] : roleReferences(latest, nodeId, role);
                    return connect(registry, removeVideoReferences(latest, nodeId, old), {
                      source: node.id,
                      sourceHandle: 'out',
                      target: nodeId,
                      targetHandle: role,
                    });
                  });
                  setOpen(false);
                }}
              >
                {media.mime.startsWith('image/') || media.posterSha256 ? (
                  <img
                    src={host.media.url(media.posterSha256 ?? media.sha256)}
                    alt=""
                    className="h-14 w-full rounded-md object-cover"
                  />
                ) : (
                  <span className="flex h-14 w-full items-center justify-center rounded-md bg-muted">
                    视频
                  </span>
                )}
                <span className="w-full truncate text-xs">{node.title ?? node.id}</span>
              </Button>
            ))}
          </div>
          {!candidates.length && (
            <p className="text-muted-foreground">画布中暂无符合当前模式、模型与剩余容量的资源</p>
          )}
          {occupied && (
            <Button
              variant="ghost"
              size="sm"
              disabled={disabled}
              className="mt-3 w-full"
              onClick={() => {
                store
                  .getState()
                  .apply((latest) =>
                    removeVideoReferences(latest, nodeId, roleReferences(latest, nodeId, role)),
                  );
                setOpen(false);
              }}
            >
              移除{label}
            </Button>
          )}
        </PopoverContent>
      </Popover>
      <span className="text-[10px] text-muted-foreground">{label}</span>
    </div>
  );
}

export function VideoReferenceSlots({
  nodeId,
  profile,
  mode,
  disabled,
}: {
  nodeId: string;
  profile: ModelProfile;
  mode: string;
  disabled: boolean;
}) {
  return (
    <div className="flex items-start gap-2">
      {mode === 'frames' ? (
        <>
          <VideoReferencePicker
            nodeId={nodeId}
            profile={profile}
            role="first_frame"
            disabled={disabled}
          />
          <ArrowLeftRight
            aria-hidden="true"
            className="mt-4 size-3.5 shrink-0 text-muted-foreground"
          />
          <VideoReferencePicker
            nodeId={nodeId}
            profile={profile}
            role="last_frame"
            disabled={disabled}
          />
        </>
      ) : (
        <VideoReferencePicker
          nodeId={nodeId}
          profile={profile}
          role="reference"
          disabled={disabled}
        />
      )}
    </div>
  );
}
