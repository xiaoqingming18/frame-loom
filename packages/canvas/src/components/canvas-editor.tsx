import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type DragEvent,
} from 'react';
import {
  Background,
  BackgroundVariant,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  SelectionMode,
  useReactFlow,
  useStore as useFlowStore,
  type Connection,
  type Edge,
  type EdgeChange,
  type FinalConnectionState,
  type NodeChange,
  type NodeMouseHandler,
  type NodeProps,
  type OnConnectStartParams,
  type Viewport,
} from '@xyflow/react';
import type { CanvasDocument, CanvasView } from '@frame-loom/contracts';
import {
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@frame-loom/ui/components/dropdown-menu';
import { TooltipProvider } from '@frame-loom/ui/components/tooltip';
import { cn } from '@frame-loom/ui/lib/utils';
import { CanvasContext, NodeActionsContext, useCanvas, useCanvasState } from '../context';
import type { CanvasHost } from '../host';
import {
  CanvasCommandError,
  connect,
  moveNodes,
  reconnect,
  reparentAfterDrag,
  updateNode,
  type Point,
} from '../commands/commands';
import { checkConnection } from '../registry/connections';
import type { NodeRegistry, NodeViewProps } from '../registry/registry';
import { createBuiltinRegistry } from '../nodes/builtin';
import { GenerationRuntime } from '../nodes/generation-runtime';
import { UnknownNodeView } from '../nodes/views';
import { createCanvasStore, type CanvasStore } from '../store/store';
import { shortcutFor, shouldIgnore } from '../interaction/keys';
import { CLIPBOARD_MIME, CLIPBOARD_PREFIX } from '../interaction/clipboard';
import { createNodeMapper, toFlowEdges, type FlowNode } from './flow-mapping';
import {
  AddNodeItems,
  ArrangeItems,
  BottomDock,
  EmptyHint,
  HelpDialog,
  Notice,
  TopRightBar,
} from './chrome';
import { PointMenu } from './point-menu';
import { UploadNode } from './upload-node';
import { useCanvasActions, ZOOM_LIMITS, type PendingConnection } from './use-actions';

const COMPACT_WIDTH = 640;
const ARIA_LABELS = {
  'node.a11yDescription.default': '按 Enter 或空格选中节点，按 Delete 删除，方向键移动。',
  'node.a11yDescription.keyboardDisabled': '按 Enter 或空格选中节点，按 Delete 删除。',
  'node.a11yDescription.ariaLiveMessage': ({
    direction,
    x,
    y,
  }: {
    direction: string;
    x: number;
    y: number;
  }) =>
    `节点已向${{ up: '上', down: '下', left: '左', right: '右' }[direction] ?? direction}移动，当前位置 ${x}, ${y}`,
  'edge.a11yDescription.default': '按 Enter 或空格选中连线，按 Delete 删除。',
  'controls.ariaLabel': '画布控件',
  'controls.zoomIn.ariaLabel': '放大',
  'controls.zoomOut.ariaLabel': '缩小',
  'controls.fitView.ariaLabel': '适应视图',
  'controls.interactive.ariaLabel': '切换交互',
  'minimap.ariaLabel': '小地图',
  'handle.ariaLabel': '端口',
};

export interface CanvasEditorProps {
  host: CanvasHost;
  /** 默认使用内置的图片、视频、分组节点。 */
  registry?: NodeRegistry;
  initialDocument?: CanvasDocument;
  initialView?: CanvasView | null;
  /** 外部持有 store 时（如需要保存），由宿主创建并传入。 */
  store?: CanvasStore;
  className?: string;
}

export function CanvasEditor({
  host,
  registry: customRegistry,
  initialDocument,
  initialView,
  store: externalStore,
  className,
}: CanvasEditorProps) {
  const registry = useMemo(() => customRegistry ?? createBuiltinRegistry(), [customRegistry]);
  const [ownStore] = useState(
    () => externalStore ?? createCanvasStore(initialDocument, initialView),
  );
  const store = externalStore ?? ownStore;
  const value = useMemo(() => ({ store, registry, host }), [store, registry, host]);
  return (
    <CanvasContext.Provider value={value}>
      <GenerationRuntime />
      <ReactFlowProvider>
        <TooltipProvider delayDuration={400}>
          <Editor className={className} />
        </TooltipProvider>
      </ReactFlowProvider>
    </CanvasContext.Provider>
  );
}

type Menu =
  | { kind: 'add'; screen: Point; flow: Point; pending?: PendingConnection }
  | { kind: 'node'; screen: Point }
  | { kind: 'edge'; screen: Point }
  | { kind: 'pane'; screen: Point; flow: Point };

function Editor({ className }: { className?: string }) {
  const { store, registry } = useCanvas();
  const flow = useReactFlow();
  const actions = useCanvasActions();
  const document = useCanvasState((state) => state.document);
  const selectedNodes = useCanvasState((state) => state.selectedNodes);
  const selectedEdges = useCanvasState((state) => state.selectedEdges);
  const hovered = useCanvasState((state) => state.hoveredNode);
  const tool = useCanvasState((state) => state.tool);
  const spaceHeld = useCanvasState((state) => state.spaceHeld);
  const view = useCanvasState((state) => state.view);
  const root = useRef<HTMLDivElement>(null);
  const documentInput = useRef<HTMLInputElement>(null);
  const pointer = useRef<Point | null>(null);
  const connecting = useRef<PendingConnection | null>(null);
  const reconnecting = useRef<string | undefined>(undefined);
  const [connectingNode, setConnectingNode] = useState<string | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [width, setWidth] = useState(1024);
  const compact = width < COMPACT_WIDTH;
  const hand = tool === 'hand' || spaceHeld;
  const readableZoom = useFlowStore((state) => state.transform[2] >= 0.4);

  const nodeTypes = useMemo(() => {
    const types: Record<string, ComponentType<NodeProps<FlowNode>>> = {};
    for (const definition of registry.list())
      types[definition.type] = makeNodeComponent(definition.View);
    return types;
  }, [registry]);
  const [mapNodes] = useState(createNodeMapper);
  const nodes = useMemo(
    () => [
      ...mapNodes(document, selectedNodes, hand).map((node) =>
        registry.supports(node.data.node) ? node : { ...node, type: 'unknown', connectable: false },
      ),
      ...actions.uploads.map(({ node, error }): FlowNode => ({
        id: node.id,
        type: 'upload',
        position: node.position,
        width: node.size.width,
        height: node.size.height,
        selectable: false,
        draggable: false,
        connectable: false,
        data: {
          node,
          upload: {
            error,
            retry: () => actions.retryImport(node.id),
            cancel: () => actions.cancelImport(node.id),
          },
        },
      })),
    ],
    [document, selectedNodes, hand, mapNodes, registry, actions],
  );
  const allNodeTypes = useMemo(
    () => ({ ...nodeTypes, unknown: UnknownFlowNode, upload: UploadNode }),
    [nodeTypes],
  );
  const edges = useMemo(() => {
    const kinds = new Map(
      document.nodes.map((node) => [node.id, registry.outputs(node)[0]?.dataType ?? 'image']),
    );
    const focus = new Set(view.edgeDisplay === 'related' ? [...selectedNodes] : []);
    if (hovered) focus.add(hovered);
    if (connectingNode) focus.add(connectingNode);
    return toFlowEdges(document, selectedEdges, view.edgeDisplay, focus, kinds);
  }, [document, registry, selectedEdges, selectedNodes, hovered, connectingNode, view.edgeDisplay]);

  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const onNodesChange = useCallback(
    (changes: NodeChange<FlowNode>[]) => {
      const state = store.getState();
      const positions = new Map<string, Point>();
      let selection: Set<string> | null = null;
      const removed = new Set<string>();
      if (changes.some((change) => change.type === 'dimensions' && change.resizing)) state.begin();
      for (const change of changes) {
        if (change.type === 'position' && change.position)
          positions.set(change.id, change.position);
        if (change.type === 'select') {
          selection ??= new Set(state.selectedNodes);
          if (change.selected) selection.add(change.id);
          else selection.delete(change.id);
        }
        if (change.type === 'remove') removed.add(change.id);
        if (change.type === 'dimensions' && change.setAttributes && change.dimensions) {
          const { width, height } = change.dimensions;
          state.apply((current) =>
            updateNode(current, change.id, {
              size: { width: Math.round(width), height: Math.round(height) },
            }),
          );
        }
      }
      if (positions.size) state.apply((current) => moveNodes(current, positions));
      // xyflow 的结束事件可能只有 resizing=false，没有尺寸；坐标也必须先写入再提交。
      if (changes.some((change) => change.type === 'dimensions' && change.resizing === false))
        state.commit();
      if (selection) state.select(selection, state.selectedEdges);
      if (removed.size) actions.deleteItems(removed);
    },
    [actions, store],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      const state = store.getState();
      let selection: Set<string> | null = null;
      for (const change of changes)
        if (change.type === 'select') {
          selection ??= new Set(state.selectedEdges);
          if (change.selected) selection.add(change.id);
          else selection.delete(change.id);
        }
      if (selection) state.select(state.selectedNodes, selection);
    },
    [store],
  );

  const isValidConnection = useCallback(
    (connection: Connection | Edge) =>
      checkConnection(registry, store.getState().document, connection, reconnecting.current).ok,
    [registry, store],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      connecting.current = null;
      try {
        store.getState().apply((current) => connect(registry, current, connection));
      } catch (error) {
        if (error instanceof CanvasCommandError) store.getState().notify(error.message);
        else throw error;
      }
    },
    [registry, store],
  );

  const onConnectStart = useCallback((_event: unknown, params: OnConnectStartParams) => {
    setConnectingNode(params.nodeId);
    connecting.current =
      params.nodeId && params.handleId && params.handleType
        ? { nodeId: params.nodeId, handleId: params.handleId, handleType: params.handleType }
        : null;
  }, []);

  const onConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent, state: FinalConnectionState) => {
      const pending = connecting.current;
      setConnectingNode(null);
      connecting.current = null;
      if (!pending) return;
      if (state.toHandle && state.isValid === false) {
        // 松手在不兼容的端口上：说明原因。
        const verdict = checkConnection(registry, store.getState().document, {
          source: pending.handleType === 'source' ? pending.nodeId : state.toHandle.nodeId,
          sourceHandle: pending.handleType === 'source' ? pending.handleId : state.toHandle.id,
          target: pending.handleType === 'source' ? state.toHandle.nodeId : pending.nodeId,
          targetHandle: pending.handleType === 'source' ? state.toHandle.id : pending.handleId,
        });
        if (!verdict.ok) store.getState().notify(verdict.reason);
        return;
      }
      if (state.toHandle || state.toNode) return;
      const point = 'changedTouches' in event ? event.changedTouches[0] : event;
      setMenu({
        kind: 'add',
        screen: { x: point.clientX, y: point.clientY },
        flow: flow.screenToFlowPosition({ x: point.clientX, y: point.clientY }),
        pending,
      });
    },
    [flow, registry, store],
  );

  const onReconnect = useCallback(
    (old: Edge, connection: Connection) => {
      try {
        store.getState().apply((current) => reconnect(registry, current, old.id, connection));
      } catch (error) {
        if (error instanceof CanvasCommandError) store.getState().notify(error.message);
        else throw error;
      }
    },
    [registry, store],
  );

  const onNodeDragStart = useCallback(() => store.getState().begin(), [store]);
  const onNodeDragStop = useCallback(
    (_event: unknown, _node: FlowNode, dragged: FlowNode[]) => {
      const state = store.getState();
      state.apply((current) => reparentAfterDrag(current, new Set(dragged.map((node) => node.id))));
      state.commit();
    },
    [store],
  );

  const onMoveEnd = useCallback(
    (_event: unknown, viewport: Viewport) => store.getState().setView({ viewport }),
    [store],
  );

  const onNodeMouseEnter = useCallback<NodeMouseHandler<FlowNode>>(
    (_event, node) => store.getState().setHovered(node.id),
    [store],
  );
  const onNodeMouseLeave = useCallback(() => store.getState().setHovered(null), [store]);
  const onNodeContextMenu = useCallback<NodeMouseHandler<FlowNode>>(
    (event, node) => {
      event.preventDefault();
      if (!store.getState().selectedNodes.has(node.id)) store.getState().select([node.id]);
      setMenu({ kind: 'node', screen: { x: event.clientX, y: event.clientY } });
    },
    [store],
  );
  const minimapNodeClassName = useCallback(
    (node: { type?: string }) => `canvas-minimap-node canvas-minimap-${node.type}`,
    [],
  );
  const onMinimapNodeClick = useCallback(
    (_event: unknown, node: { id: string }) => {
      store.getState().select([node.id]);
      void flow.fitView({ nodes: [{ id: node.id }], duration: 250, maxZoom: 1 });
    },
    [flow, store],
  );

  // 快捷键：只在焦点位于画布内时处理，空格临时切换抓手。
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const inCanvas = (event: Event) =>
      event.target instanceof window.Node
        ? element.contains(event.target)
        : element.contains(window.document.activeElement);
    const down = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        !inCanvas(event) ||
        shouldIgnore(event) ||
        window.document.querySelector('[role=dialog]')
      )
        return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      // 单选控件用方向键切换选项，不应触发画布的节点微移。
      if (target?.closest('[role="radio"], [role="menuitemradio"]')) return;
      const state = store.getState();
      if (event.code === 'Space' && !event.ctrlKey && !event.metaKey && !event.altKey) {
        // 按钮上的空格保留原生点击语义；画布和节点上的空格临时平移。
        if (target?.closest('button, [role=button], a[href]')) return;
        event.preventDefault();
        event.stopPropagation();
        if (!event.repeat) state.setSpaceHeld(true);
        return;
      }
      const action = shortcutFor(event);
      if (!action) return;
      event.preventDefault();
      // 在 xyflow 节点处理方向键前截获，避免同时移动两次并丢失撤销事务。
      event.stopPropagation();
      const step = event.shiftKey ? 10 : 1;
      switch (action) {
        case 'tool-pointer':
          return state.setTool('pointer');
        case 'tool-select':
          return state.setTool('select');
        case 'tool-hand':
          return state.setTool('hand');
        case 'add-node':
          return setAddOpen(true);
        case 'help':
          return setHelpOpen(true);
        case 'toggle-minimap':
          return state.setView({ minimap: !state.view.minimap });
        case 'fit-view':
          return actions.fitView();
        case 'zoom-reset':
          return actions.zoomTo(1);
        case 'zoom-in':
          return actions.zoomIn();
        case 'zoom-out':
          return actions.zoomOut();
        case 'select-all':
          return actions.selectAll();
        case 'deselect':
          setMenu(null);
          return state.select([]);
        case 'delete':
          return actions.deleteSelection();
        case 'duplicate':
          return actions.duplicate();
        case 'rename':
          return actions.rename();
        case 'undo':
          return actions.undo();
        case 'redo':
          return actions.redo();
        case 'group':
          return actions.group();
        case 'ungroup':
          return actions.ungroup();
        case 'nudge-left':
          return actions.nudge(-step, 0);
        case 'nudge-right':
          return actions.nudge(step, 0);
        case 'nudge-up':
          return actions.nudge(0, -step);
        case 'nudge-down':
          return actions.nudge(0, step);
      }
    };
    const up = (event: KeyboardEvent) => {
      if (event.code === 'Space') store.getState().setSpaceHeld(false);
    };
    const blur = () => store.getState().setSpaceHeld(false);
    const visibility = () => {
      if (window.document.hidden) blur();
    };
    const copy = (event: ClipboardEvent) => {
      if (!inCanvas(event) || shouldIgnoreTarget(event.target)) return;
      const text = actions.copy();
      if (!text || !event.clipboardData) return;
      event.preventDefault();
      event.clipboardData.setData(CLIPBOARD_MIME, text);
      event.clipboardData.setData('text/plain', text);
      if (event.type === 'cut') actions.deleteSelection();
    };
    const paste = (event: ClipboardEvent) => {
      if (!inCanvas(event) || shouldIgnoreTarget(event.target) || !event.clipboardData) return;
      const at = pointer.current ?? undefined;
      const files = [...event.clipboardData.files];
      if (files.length) {
        event.preventDefault();
        void actions.importFiles(files, at);
        return;
      }
      const text =
        event.clipboardData.getData(CLIPBOARD_MIME) || event.clipboardData.getData('text/plain');
      if (text.startsWith(CLIPBOARD_PREFIX)) {
        event.preventDefault();
        if (!actions.paste(text, at)) store.getState().notify('剪贴板内容无效或过大');
      }
    };
    window.addEventListener('keydown', down, true);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    window.document.addEventListener('visibilitychange', visibility);
    window.document.addEventListener('copy', copy);
    window.document.addEventListener('cut', copy);
    window.document.addEventListener('paste', paste);
    return () => {
      window.removeEventListener('keydown', down, true);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
      window.document.removeEventListener('visibilitychange', visibility);
      window.document.removeEventListener('copy', copy);
      window.document.removeEventListener('cut', copy);
      window.document.removeEventListener('paste', paste);
    };
  }, [actions, store]);

  const onDrop = (event: DragEvent) => {
    setDragOver(false);
    const files = [...event.dataTransfer.files];
    if (!files.length) return;
    event.preventDefault();
    void actions.importFiles(
      files,
      flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }),
    );
  };

  const selectionTool = tool === 'select' && !spaceHeld;
  const empty = document.nodes.length === 0 && actions.uploads.length === 0;
  const selectedCount = selectedNodes.size;
  const locked = [...selectedNodes].some(
    (id) => document.nodes.find((node) => node.id === id)?.locked,
  );

  const content = (
    <div
      ref={root}
      role="region"
      aria-label="画布编辑区"
      tabIndex={0}
      onPointerDownCapture={(event) => {
        const target = event.target as HTMLElement;
        if (
          event.currentTarget.contains(target) &&
          !target.closest(
            'button, a[href], input, textarea, select, [contenteditable], [role="radio"]',
          )
        )
          event.currentTarget.focus({ preventScroll: true });
      }}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget))
          store.getState().setSpaceHeld(false);
      }}
      className={cn(
        'frame-loom-canvas relative size-full overflow-hidden bg-canvas',
        dragOver && 'canvas-drop-target',
        className,
      )}
      onPointerMove={(event) => {
        pointer.current = flow.screenToFlowPosition({ x: event.clientX, y: event.clientY });
      }}
      onDragOver={(event) => {
        if (![...event.dataTransfer.types].includes('Files')) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
        setDragOver(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragOver(false);
      }}
      onDrop={onDrop}
    >
      <ReactFlow<FlowNode>
        nodes={nodes}
        edges={edges}
        nodeTypes={allNodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onConnectStart={onConnectStart}
        onConnectEnd={onConnectEnd}
        onReconnect={onReconnect}
        onReconnectStart={(_event, edge) => {
          reconnecting.current = edge.id;
          setConnectingNode(edge.source);
        }}
        onReconnectEnd={() => {
          reconnecting.current = undefined;
          setConnectingNode(null);
        }}
        isValidConnection={isValidConnection}
        onNodeDragStart={onNodeDragStart}
        onNodeDragStop={onNodeDragStop}
        onSelectionDragStart={onNodeDragStart}
        onSelectionDragStop={(event, dragged) => onNodeDragStop(event, dragged[0], dragged)}
        onNodeMouseEnter={onNodeMouseEnter}
        onNodeMouseLeave={onNodeMouseLeave}
        onNodeContextMenu={onNodeContextMenu}
        onSelectionContextMenu={(event) => {
          event.preventDefault();
          setMenu({ kind: 'node', screen: { x: event.clientX, y: event.clientY } });
        }}
        onEdgeContextMenu={(event, edge) => {
          event.preventDefault();
          store.getState().select([], [edge.id]);
          setMenu({ kind: 'edge', screen: { x: event.clientX, y: event.clientY } });
        }}
        onPaneContextMenu={(event) => {
          event.preventDefault();
          setMenu({
            kind: 'pane',
            screen: { x: event.clientX, y: event.clientY },
            flow: flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }),
          });
        }}
        onDoubleClick={(event) => {
          // 只响应空白处的双击，节点内部双击用于重命名等。
          if (!(event.target as HTMLElement).classList.contains('react-flow__pane') || hand) return;
          setMenu({
            kind: 'add',
            screen: { x: event.clientX, y: event.clientY },
            flow: flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }),
          });
        }}
        onMoveEnd={onMoveEnd}
        defaultViewport={view.viewport}
        minZoom={ZOOM_LIMITS.min}
        maxZoom={ZOOM_LIMITS.max}
        zoomOnDoubleClick={false}
        deleteKeyCode={null}
        selectionKeyCode={null}
        multiSelectionKeyCode={['Shift', 'Control', 'Meta']}
        panActivationKeyCode={null}
        panOnDrag={selectionTool ? [1] : [0, 1]}
        selectionOnDrag={selectionTool}
        selectionMode={SelectionMode.Partial}
        nodesDraggable={!hand}
        elementsSelectable={!hand}
        nodesConnectable={!hand}
        connectionRadius={32}
        onlyRenderVisibleElements={document.nodes.length > 50 && readableZoom}
        elevateNodesOnSelect={false}
        disableKeyboardA11y={false}
        ariaLabelConfig={ARIA_LABELS}
        proOptions={{ hideAttribution: true }}
        className={cn(hand && 'canvas-hand', spaceHeld && 'canvas-space')}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={24}
          size={1}
          className="canvas-background"
        />
        {view.minimap && !compact && (
          <MiniMap
            position="top-right"
            pannable
            zoomable
            ariaLabel="小地图"
            nodeClassName={minimapNodeClassName}
            nodeBorderRadius={4}
            className="canvas-minimap"
            onNodeClick={onMinimapNodeClick}
          />
        )}
      </ReactFlow>
      {empty && <EmptyHint />}
      <div className="absolute top-4 right-4 z-10">
        <TopRightBar actions={actions} compact={compact} />
      </div>
      <BottomDock
        actions={actions}
        addOpen={addOpen}
        onAddOpenChange={setAddOpen}
        onHelp={() => setHelpOpen(true)}
      />
      <Notice />
      <HelpDialog open={helpOpen} onOpenChange={setHelpOpen} />
      <input
        ref={documentInput}
        type="file"
        accept=".json,application/json"
        aria-label="导入画布 JSON"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void actions.importDocument(file);
          event.target.value = '';
        }}
      />
      <PointMenu
        at={menu?.screen ?? null}
        onClose={() => setMenu(null)}
        label={menu?.kind === 'add' ? '添加节点' : '画布菜单'}
      >
        {menu?.kind === 'add' && (
          <>
            <DropdownMenuLabel>{menu.pending ? '添加并连接' : '添加节点'}</DropdownMenuLabel>
            <AddNodeItems
              actions={actions}
              at={menu.flow}
              pending={menu.pending}
              accepts={
                menu.pending
                  ? (type) => canConnectNew(registry, store, menu.pending!, type)
                  : undefined
              }
            />
          </>
        )}
        {menu?.kind === 'pane' && (
          <>
            <DropdownMenuLabel>添加节点</DropdownMenuLabel>
            <AddNodeItems actions={actions} at={menu.flow} />
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => actions.selectAll()}>
              全选<DropdownMenuShortcut>Ctrl+A</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => actions.fitView()}>
              适应视图<DropdownMenuShortcut>Shift+1</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>整理</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <ArrangeItems actions={actions} />
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => actions.exportDocument()}>导出 JSON</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => documentInput.current?.click()}>
              导入 JSON（替换画布，可撤销）
            </DropdownMenuItem>
          </>
        )}
        {menu?.kind === 'edge' && (
          <DropdownMenuItem variant="destructive" onSelect={() => actions.deleteSelection()}>
            删除连线<DropdownMenuShortcut>Delete</DropdownMenuShortcut>
          </DropdownMenuItem>
        )}
        {menu?.kind === 'node' && (
          <>
            <DropdownMenuItem disabled={selectedCount !== 1} onSelect={() => actions.rename()}>
              重命名<DropdownMenuShortcut>F2</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => actions.duplicate()}>
              原地复制<DropdownMenuShortcut>Ctrl+D</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => actions.group()}>
              分组<DropdownMenuShortcut>Ctrl+G</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => actions.ungroup()}>
              解组<DropdownMenuShortcut>Ctrl+Shift+G</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={
                !document.nodes.some(
                  (node) => selectedNodes.has(node.id) && node.type === 'group' && !node.locked,
                )
              }
              onSelect={() => actions.fitGroups()}
            >
              适应内容
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>整理</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <ArrangeItems actions={actions} />
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => actions.reorder('front')}>置于顶层</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => actions.reorder('back')}>置于底层</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => actions.setLocked(!locked)}>
              {locked ? '解除锁定' : '锁定'}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => actions.deleteSelection()}>
              删除<DropdownMenuShortcut>Delete</DropdownMenuShortcut>
            </DropdownMenuItem>
          </>
        )}
      </PointMenu>
    </div>
  );
  return (
    <NodeActionsContext.Provider
      value={{
        addConnected: (nodeId, screen) =>
          setMenu({
            kind: 'add',
            screen,
            flow: flow.screenToFlowPosition(screen),
            pending: { nodeId, handleId: 'out', handleType: 'source' },
          }),
      }}
    >
      {content}
    </NodeActionsContext.Provider>
  );
}

function shouldIgnoreTarget(target: EventTarget | null) {
  const element = target as HTMLElement | null;
  return !!element?.closest?.(
    'input, textarea, select, [contenteditable=""], [contenteditable="true"]',
  );
}

/** 拖线到空白处时，只列出能与起点端口相连的节点类型。 */
function canConnectNew(
  registry: NodeRegistry,
  store: CanvasStore,
  pending: PendingConnection,
  type: string,
) {
  const definition = registry.get(type);
  if (!definition) return false;
  const probe = {
    id: '__probe__',
    type,
    typeVersion: definition.version,
    position: { x: 0, y: 0 },
    size: definition.defaultSize,
    data: definition.createData(),
  };
  const document = store.getState().document;
  const withProbe = { ...document, nodes: [...document.nodes, probe] };
  const ports = pending.handleType === 'source' ? registry.inputs(probe) : registry.outputs(probe);
  return ports.some(
    (port) =>
      checkConnection(registry, withProbe, {
        source: pending.handleType === 'source' ? pending.nodeId : probe.id,
        sourceHandle: pending.handleType === 'source' ? pending.handleId : port.id,
        target: pending.handleType === 'source' ? probe.id : pending.nodeId,
        targetHandle: pending.handleType === 'source' ? port.id : pending.handleId,
      }).ok,
  );
}

function makeNodeComponent(View: ComponentType<NodeViewProps>) {
  return memo(function CanvasFlowNode({ data, selected }: NodeProps<FlowNode>) {
    return <View node={data.node} selected={!!selected} />;
  });
}

function UnknownFlowNode({ data }: NodeProps<FlowNode>) {
  return <UnknownNodeView node={data.node} />;
}
