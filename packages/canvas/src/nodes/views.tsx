import { useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Handle,
  NodeResizer,
  NodeToolbar,
  Position,
  useConnection,
  useUpdateNodeInternals,
} from '@xyflow/react';
import {
  ChevronLeft,
  ChevronRight,
  Film,
  ImageIcon,
  Loader2,
  Lock,
  Plus,
  Upload,
} from 'lucide-react';
import type { CanvasGroupData, CanvasMediaData, CanvasVideoMode } from '@frame-loom/contracts';
import { cn } from '@frame-loom/ui/lib/utils';
import { Button } from '@frame-loom/ui/components/button';
import { NodeActionsContext, useCanvas, useCanvasState } from '../context';
import {
  changeDataDroppingEdges,
  isNodeLocked,
  updateData,
  updateNode,
} from '../commands/commands';
import type { InputPort, NodeViewProps, OutputPort } from '../registry/registry';
import { activeVersion, appendVersion, GROUP_COLORS, VIDEO_MODES } from './media';
import { importMedia } from '../interaction/media-import';
import { GenerationStatus } from './generation-status';
import { checkConnection } from '../registry/connections';
import { GenerationPanel } from './generation-panel';
import { generationModel } from './generation-inputs';

const portClass: Record<string, string> = {
  image: 'canvas-port-image',
  video: 'canvas-port-video',
  audio: 'canvas-port-audio',
  text: 'canvas-port-text',
};

/** 输入框保持屏幕尺寸与节点下方锚点，超出视口时通过平移画布查看。 */
function ComposerToolbar({ children, offset }: { children: ReactNode; offset: number }) {
  return (
    <NodeToolbar isVisible position={Position.Bottom} offset={offset}>
      <div className="nowheel w-[620px] rounded-2xl">{children}</div>
    </NodeToolbar>
  );
}

function Ports({
  nodeId,
  inputs,
  outputs,
  disabledInputs = [],
}: {
  nodeId: string;
  inputs: readonly InputPort[];
  outputs: readonly OutputPort[];
  disabledInputs?: readonly string[];
}) {
  const update = useUpdateNodeInternals();
  const { registry, store } = useCanvas();
  const from = useConnection((connection) => connection.fromHandle);
  const incompatible = (id: string, type: 'source' | 'target') => {
    if (!from || from.type === type) return false;
    return !checkConnection(registry, store.getState().document, {
      source: type === 'source' ? nodeId : from.nodeId,
      sourceHandle: type === 'source' ? id : from.id,
      target: type === 'target' ? nodeId : from.nodeId,
      targetHandle: type === 'target' ? id : from.id,
    }).ok;
  };
  const key = inputs.map((port) => port.id).join();
  const previousKey = useRef(key);
  // 端口随视频方式增减时，xyflow 需要重新测量端口位置。
  useEffect(() => {
    if (previousKey.current === key) return;
    previousKey.current = key;
    update(nodeId);
  }, [key, nodeId, update]);
  return (
    <>
      {inputs.map((port, index) => (
        <Handle
          key={port.id}
          id={port.id}
          type="target"
          isConnectable={!disabledInputs.includes(port.id)}
          position={Position.Left}
          title={
            disabledInputs.includes(port.id)
              ? `${port.label}（当前模型不支持）`
              : `${port.label}（接受 ${port.accepts.map((kind) => kindName[kind]).join('、')}）`
          }
          aria-label={port.label}
          className={cn(
            'canvas-port',
            portClass[port.accepts[0]],
            (disabledInputs.includes(port.id) || incompatible(port.id, 'target')) &&
              'canvas-port-incompatible',
          )}
          style={{ top: `${((index + 1) / (inputs.length + 1)) * 100}%` }}
        >
          {inputs.length > 1 && <span className="canvas-port-label">{port.label}</span>}
        </Handle>
      ))}
      {outputs.map((port) => (
        <Handle
          key={port.id}
          id={port.id}
          type="source"
          position={Position.Right}
          title={`输出${port.label}`}
          aria-label={`输出${port.label}`}
          className={cn(
            'canvas-port',
            portClass[port.dataType],
            incompatible(port.id, 'source') && 'canvas-port-incompatible',
          )}
        />
      ))}
    </>
  );
}

const kindName = { image: '图片', video: '视频', audio: '音频', text: '文本' };

function TitleInput({ nodeId, title }: { nodeId: string; title: string }) {
  const { store } = useCanvas();
  const [value, setValue] = useState(title);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.select(), []);
  const finish = (save: boolean) => {
    const state = store.getState();
    if (save && value.trim() && value.trim() !== title)
      state.apply((document) =>
        updateNode(document, nodeId, { title: value.trim().slice(0, 200) }),
      );
    state.setEditingTitle(null);
  };
  return (
    <input
      ref={input}
      aria-label="节点名称"
      className="nodrag nopan min-w-0 flex-1 rounded-sm border bg-card px-1 text-foreground outline-none focus:border-ring"
      value={value}
      maxLength={200}
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.nativeEvent.isComposing) return;
        if (event.key === 'Enter') finish(true);
        if (event.key === 'Escape') finish(false);
      }}
    />
  );
}

export function NodeTitle({
  nodeId,
  title,
  icon,
}: {
  nodeId: string;
  title: string;
  icon: ReactNode;
}) {
  const { store } = useCanvas();
  const editing = useCanvasState((state) => state.editingTitle === nodeId);
  const locked = useCanvasState((state) => {
    const node = state.document.nodes.find((node) => node.id === nodeId);
    return !!node && isNodeLocked(state.document, node);
  });
  return (
    <div className="flex h-6 min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
      <span aria-hidden="true" className="shrink-0 [&_svg]:size-3.5">
        {icon}
      </span>
      {editing ? (
        <TitleInput nodeId={nodeId} title={title} />
      ) : (
        <span
          className="truncate"
          onDoubleClick={(event) => {
            event.stopPropagation();
            if (!locked) store.getState().setEditingTitle(nodeId);
          }}
        >
          {title}
        </span>
      )}
    </div>
  );
}

function MediaFrame({
  node,
  selected,
  kind,
  children,
  toolbar,
}: NodeViewProps<CanvasMediaData> & {
  kind: 'image' | 'video';
  children: ReactNode;
  toolbar?: ReactNode;
}) {
  const { registry, store } = useCanvas();
  const definition = registry.get(node.type)!;
  const locked = useCanvasState((state) => isNodeLocked(state.document, node));
  const inputCount = useCanvasState(
    (state) => state.document.edges.filter((edge) => edge.target === node.id).length,
  );
  const edgeDisplay = useCanvasState((state) => state.view.edgeDisplay);
  const { host } = useCanvas();
  const Generation = host.generation?.Panel ?? GenerationPanel;
  const single = useCanvasState((state) => state.selectedNodes.size <= 1);
  const nodeActions = useContext(NodeActionsContext);
  const profile = useCanvasState(
    (state) => generationModel(state.generationConfig, kind, node.data.modelId)?.profile,
  );
  const disabledInputs =
    profile?.constraints.flatMap((rule) =>
      Object.keys(rule.when).length === 0 ? (rule.forbidRoles ?? []) : [],
    ) ?? [];
  return (
    <div className="flex size-full flex-col">
      <div className="absolute -top-7 right-0 left-0 flex items-center justify-between gap-2">
        <NodeTitle
          nodeId={node.id}
          title={node.title ?? definition.label}
          icon={kind === 'image' ? <ImageIcon /> : <Film />}
        />
        <div className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
          {locked && <Lock aria-label="已锁定" className="size-3" />}
          {edgeDisplay !== 'all' && inputCount > 0 && (
            <span title="参考数量">{inputCount} 个参考</span>
          )}
        </div>
      </div>
      <NodeResizer
        isVisible={selected && !locked}
        minWidth={definition.minSize.width}
        minHeight={definition.minSize.height}
        keepAspectRatio={definition.keepAspect}
        lineClassName="canvas-resize-line"
        handleClassName="canvas-resize-handle"
      />
      {toolbar}
      <div
        className={cn(
          'canvas-node-card group relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border bg-card',
          selected && 'canvas-node-selected',
        )}
      >
        <div className="relative min-h-0 flex-1 overflow-hidden">
          {children}
          <GenerationStatus nodeId={node.id} data={node.data} />
          {node.data.versions.length > 1 && (
            <div
              aria-label="当前版本"
              className="nodrag nopan absolute right-2 bottom-2 left-2 flex items-center justify-center gap-2 rounded-full border bg-card/95 p-1 text-xs opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100"
            >
              <Button
                variant="ghost"
                size="icon"
                aria-label="上一版本"
                disabled={locked || node.data.activeVersion === 0}
                onClick={() =>
                  store.getState().apply((document) =>
                    updateData<CanvasMediaData>(document, node.id, (data) => ({
                      ...data,
                      activeVersion: data.activeVersion - 1,
                    })),
                  )
                }
              >
                <ChevronLeft aria-hidden="true" className="size-4" />
              </Button>
              <span>
                {node.data.activeVersion + 1}/{node.data.versions.length}
              </span>
              <Button
                variant="ghost"
                size="icon"
                aria-label="下一版本"
                disabled={locked || node.data.activeVersion === node.data.versions.length - 1}
                onClick={() =>
                  store.getState().apply((document) =>
                    updateData<CanvasMediaData>(document, node.id, (data) => ({
                      ...data,
                      activeVersion: data.activeVersion + 1,
                    })),
                  )
                }
              >
                <ChevronRight aria-hidden="true" className="size-4" />
              </Button>
            </div>
          )}
        </div>
        {!host.generation && (
          <div className="p-2 text-xs text-muted-foreground">生成能力尚未接入</div>
        )}
      </div>
      {selected && single && (
        <ComposerToolbar offset={kind === 'video' ? 48 : 16}>
          <Generation nodeId={node.id} kind={kind} data={node.data} />
        </ComposerToolbar>
      )}
      {nodeActions && (
        <Button
          variant="outline"
          size="icon"
          aria-label="添加并连接"
          disabled={locked}
          className="nodrag nopan absolute top-1/2 -right-12 -translate-y-1/2 rounded-full bg-card"
          onClick={(event) =>
            nodeActions.addConnected(node.id, { x: event.clientX + 24, y: event.clientY })
          }
        >
          <Plus aria-hidden="true" className="size-4" />
        </Button>
      )}
      <Ports
        nodeId={node.id}
        inputs={registry.inputs(node)}
        outputs={registry.outputs(node)}
        disabledInputs={disabledInputs}
      />
    </div>
  );
}

function Empty({ kind, pending }: { kind: 'image' | 'video'; pending: boolean }) {
  return (
    <div className="flex size-full flex-col items-center justify-center gap-2 text-xs text-muted-foreground">
      {pending ? (
        <Loader2 aria-hidden="true" className="size-6 animate-spin" />
      ) : kind === 'image' ? (
        <ImageIcon aria-hidden="true" className="size-6" strokeWidth={1.25} />
      ) : (
        <Film aria-hidden="true" className="size-6" strokeWidth={1.25} />
      )}
      <span>{pending ? '生成中…' : kind === 'image' ? '拖入或粘贴图片' : '拖入或粘贴视频'}</span>
    </div>
  );
}

export function ImageNodeView(props: NodeViewProps<CanvasMediaData>) {
  const { host, store } = useCanvas();
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const locked = useCanvasState((state) => isNodeLocked(state.document, props.node));
  const version = activeVersion(props.node.data);
  // shortcut: 直接展示原图，实测出现大量 4K 图片解码内存压力时由 engine 生成缩略图。
  return (
    <MediaFrame
      {...props}
      kind="image"
      toolbar={
        props.selected &&
        !version && (
          <div className="nodrag nopan absolute -top-12 left-1/2 -translate-x-1/2">
            <input
              ref={fileInput}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              aria-label="选择上传图片"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (!file || uploading || locked) return;
                setUploading(true);
                void importMedia(host, file)
                  .then(({ version }) => {
                    const current = store.getState();
                    if (!current.document.nodes.some((node) => node.id === props.node.id)) return;
                    current.apply((document) =>
                      updateData<CanvasMediaData>(document, props.node.id, (data) =>
                        appendVersion(data, version),
                      ),
                    );
                  })
                  .catch((error: unknown) =>
                    store.getState().notify(error instanceof Error ? error.message : '上传失败'),
                  )
                  .finally(() => setUploading(false));
              }}
            />
            <Button
              variant="outline"
              size="sm"
              disabled={locked || uploading}
              onClick={() => fileInput.current?.click()}
              className="rounded-full bg-card"
            >
              <Upload aria-hidden="true" className="size-3.5" />
              {uploading ? '正在上传…' : '上传图片'}
            </Button>
            {host.assets && (
              <Button
                variant="outline"
                size="sm"
                disabled={locked || uploading}
                onClick={() => {
                  setUploading(true);
                  void host
                    .assets!.pick('image')
                    .then((picked) => {
                      if (!picked) return;
                      const current = store.getState();
                      const node = current.document.nodes.find((node) => node.id === props.node.id);
                      if (!node || isNodeLocked(current.document, node)) return;
                      current.apply((document) =>
                        updateData<CanvasMediaData>(document, node.id, (data) =>
                          appendVersion(data, picked.version),
                        ),
                      );
                    })
                    .catch((error: unknown) =>
                      store
                        .getState()
                        .notify(error instanceof Error ? error.message : '添加资产失败'),
                    )
                    .finally(() => setUploading(false));
                }}
              >
                从项目资产添加
              </Button>
            )}
          </div>
        )
      }
    >
      {version ? (
        <MediaPreview key={version.sha256}>
          <img
            src={host.media.url(version.sha256)}
            alt={props.node.title ?? '图片'}
            draggable={false}
            decoding="async"
            loading="lazy"
            className="size-full object-contain"
          />
        </MediaPreview>
      ) : (
        <Empty kind="image" pending={!!props.node.data.pendingJobIds?.length} />
      )}
    </MediaFrame>
  );
}

export function VideoNodeView(props: NodeViewProps<CanvasMediaData>) {
  const { host, store, registry } = useCanvas();
  const version = activeVersion(props.node.data);
  const locked = useCanvasState((state) => isNodeLocked(state.document, props.node));
  const active = useCanvasState((state) => {
    const playable = (id: string) =>
      state.document.nodes.some(
        (node) =>
          node.id === id &&
          node.type === 'video' &&
          registry.supports(node) &&
          !!activeVersion(node.data as CanvasMediaData),
      );
    const id =
      state.hoveredNode && playable(state.hoveredNode)
        ? state.hoveredNode
        : [...state.selectedNodes].find(playable);
    return id === props.node.id;
  });
  // 悬停优先，其次选中的第一个视频；整张画布最多挂载一个预览播放器。
  const play = !!version && active;
  const mode = props.node.data.mode ?? 'text';
  const profile = useCanvasState(
    (state) => generationModel(state.generationConfig, 'video', props.node.data.modelId)?.profile,
  );
  const setMode = (next: CanvasVideoMode) => {
    if (next === mode) return;
    const state = store.getState();
    let dropped = 0;
    const changed = state.apply((document) => {
      const result = changeDataDroppingEdges<CanvasMediaData>(
        registry,
        document,
        props.node.id,
        (data) => ({
          ...data,
          mode: next,
        }),
      );
      dropped = result.dropped;
      return result.document;
    });
    if (changed && dropped)
      state.notify(
        `已切换为${VIDEO_MODES.find((item) => item.id === next)!.label}，断开 ${dropped} 条不兼容的连线`,
      );
  };
  return (
    <MediaFrame
      {...props}
      kind="video"
      toolbar={
        <div
          role="radiogroup"
          aria-label="生成方式"
          className="nodrag nopan absolute -bottom-9 left-1/2 flex -translate-x-1/2 gap-0.5 rounded-lg border bg-popover p-0.5 shadow-canvas-panel"
        >
          {VIDEO_MODES.filter(
            (item) => !profile || profile.modes.some((mode) => mode.id === item.id),
          ).map((item) => (
            <button
              key={item.id}
              type="button"
              role="radio"
              aria-checked={mode === item.id}
              disabled={locked}
              onClick={() => setMode(item.id)}
              className={cn(
                'rounded-md px-2 py-1 text-xs whitespace-nowrap text-muted-foreground hover:bg-accent disabled:opacity-50',
                mode === item.id && 'bg-accent-active text-foreground',
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      }
    >
      {version ? (
        <MediaPreview key={`${version.sha256}/${play}`}>
          {play ? (
            <video
              src={host.media.url(version.sha256)}
              poster={version.posterSha256 ? host.media.url(version.posterSha256) : undefined}
              aria-label={props.node.title ?? '视频'}
              muted
              loop
              autoPlay
              playsInline
              preload="metadata"
              className="size-full object-contain"
            />
          ) : version.posterSha256 ? (
            <img
              src={host.media.url(version.posterSha256)}
              alt={props.node.title ?? '视频封面'}
              draggable={false}
              decoding="async"
              className="size-full object-contain"
            />
          ) : (
            <div className="flex size-full items-center justify-center text-muted-foreground">
              <Film aria-hidden="true" className="size-6" strokeWidth={1.25} />
            </div>
          )}
        </MediaPreview>
      ) : (
        <Empty kind="video" pending={!!props.node.data.pendingJobIds?.length} />
      )}
    </MediaFrame>
  );
}

/** 失败只改变展示，不移除版本记录，恢复文件后可重新进入页面。 */
function MediaPreview({ children }: { children: ReactNode }) {
  const [missing, setMissing] = useState(false);
  return (
    <div className="size-full" onErrorCapture={() => setMissing(true)}>
      {missing ? (
        <div
          role="status"
          className="flex size-full items-center justify-center text-sm text-muted-foreground"
        >
          素材缺失
        </div>
      ) : (
        children
      )}
    </div>
  );
}

export function GroupNodeView({ node, selected }: NodeViewProps<CanvasGroupData>) {
  const { registry, store } = useCanvas();
  const definition = registry.get('group')!;
  return (
    <div
      className={cn(
        'canvas-group size-full rounded-xl border',
        `canvas-group-${node.data.color}`,
        selected && 'canvas-node-selected',
      )}
    >
      <NodeResizer
        isVisible={selected && !node.locked}
        minWidth={definition.minSize.width}
        minHeight={definition.minSize.height}
        lineClassName="canvas-resize-line"
        handleClassName="canvas-resize-handle"
      />
      <div className="flex items-center justify-between gap-2 px-3 pt-2.5">
        <NodeTitle nodeId={node.id} title={node.title ?? definition.label} icon={null} />
        {node.locked && <Lock aria-label="已锁定" className="size-3 text-muted-foreground" />}
        {selected && !node.locked && (
          <div
            className="nodrag nopan flex max-w-36 flex-wrap justify-end gap-1"
            role="radiogroup"
            aria-label="分组颜色"
          >
            {GROUP_COLORS.map((color, index) => (
              <Button
                key={color.id}
                type="button"
                role="radio"
                variant="ghost"
                tabIndex={node.data.color === color.id ? 0 : -1}
                aria-checked={node.data.color === color.id}
                aria-label={color.label}
                title={color.label}
                onKeyDown={(event) => {
                  const offset = ['ArrowRight', 'ArrowDown'].includes(event.key)
                    ? 1
                    : ['ArrowLeft', 'ArrowUp'].includes(event.key)
                      ? -1
                      : 0;
                  if (!offset && event.key !== 'Home' && event.key !== 'End') return;
                  event.preventDefault();
                  const next =
                    event.key === 'Home'
                      ? 0
                      : event.key === 'End'
                        ? GROUP_COLORS.length - 1
                        : (index + offset + GROUP_COLORS.length) % GROUP_COLORS.length;
                  const target =
                    event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
                      '[role=radio]',
                    )[next];
                  target?.focus();
                  target?.click();
                }}
                onClick={() =>
                  store
                    .getState()
                    .apply((document) =>
                      updateData<CanvasGroupData>(document, node.id, () => ({ color: color.id })),
                    )
                }
                className={cn(
                  'canvas-group-swatch size-3.5 rounded-full border p-0',
                  `canvas-group-${color.id}`,
                  node.data.color === color.id && 'ring-2 ring-ring',
                )}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** 未注册类型（例如新版本创建的节点）的占位视图，数据原样保留。 */
export function UnknownNodeView({ node }: { node: { type: string; title?: string } }) {
  return (
    <div className="flex size-full items-center justify-center rounded-lg border border-dashed bg-card p-3 text-center text-xs text-muted-foreground">
      当前版本不支持「{node.title ?? node.type}」节点，数据已保留。
    </div>
  );
}
