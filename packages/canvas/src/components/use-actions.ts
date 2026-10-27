import { useMemo, useRef, useState } from 'react';
import { useReactFlow } from '@xyflow/react';
import { CANVAS_LIMITS, type CanvasDocument, type CanvasMediaData } from '@frame-loom/contracts';
import { useCanvas } from '../context';
import {
  addNodes,
  CanvasCommandError,
  connect,
  createNode,
  deleteElements,
  groupNodes,
  fitGroup,
  isNodeLocked,
  nudge,
  reorder,
  setLocked,
  ungroup,
  updateData,
  type Point,
} from '../commands/commands';
import { arrange, type ArrangeMode, type ArrangeOrder } from '../layout/layout';
import { downloadCanvasDocument, parseDocument } from '../interaction/document-file';
import {
  copySelection,
  deserialize,
  instantiate,
  serialize,
  CLIPBOARD_MIME,
} from '../interaction/clipboard';
import { checkConnection } from '../registry/connections';
import { useMediaImports } from './use-media-imports';
import { resolveTags } from '../interaction/tags';
import { adoptMedia } from '../interaction/adopt-media';
import { activeVersion, appendVersion, emptyMedia, fitMediaSize } from '../nodes/media';

export const ZOOM_LIMITS = { min: 0.1, max: 4 };
const PASTE_OFFSET = 24;

export type PendingConnection = {
  nodeId: string;
  handleId: string;
  handleType: 'source' | 'target';
};

/** 画布编辑动作集合：底部栏、右上工具组、快捷键与右键菜单共用。 */
export function useCanvasActions() {
  const { store, registry, host } = useCanvas();
  const flow = useReactFlow();
  const imports = useMediaImports();
  const paste = useRef({ count: 0, at: null as Point | null });
  const [arrangeOrder, setArrangeOrder] = useState<ArrangeOrder>('created');

  return useMemo(() => {
    const state = () => store.getState();
    const run = (change: (document: CanvasDocument) => CanvasDocument) => state().apply(change);
    const viewportCenter = (): Point => {
      const pane = document.querySelector('.react-flow');
      const rect = pane?.getBoundingClientRect();
      return flow.screenToFlowPosition({
        x: (rect?.left ?? 0) + (rect?.width ?? 0) / 2,
        y: (rect?.top ?? 0) + (rect?.height ?? 0) / 2,
      });
    };
    // 连续粘贴的偏移计数只在事件处理中读写，不参与渲染。
    const pasteState = paste.current;

    const actions = {
      addNode(type: string, at: Point = viewportCenter(), pending?: PendingConnection) {
        const node = createNode(registry, type, at);
        const ok = run((document) => {
          const next = addNodes(document, [node]);
          if (!pending) return next;
          const source = pending.handleType === 'source';
          const ports = source ? registry.inputs(node) : registry.outputs(node);
          for (const port of ports) {
            const attempt = {
              source: source ? pending.nodeId : node.id,
              sourceHandle: source ? pending.handleId : port.id,
              target: source ? node.id : pending.nodeId,
              targetHandle: source ? port.id : pending.handleId,
            };
            if (checkConnection(registry, next, attempt).ok)
              return connect(registry, next, attempt);
          }
          throw new CanvasCommandError('没有可连接的端口');
        });
        if (ok) state().select([node.id]);
        return node.id;
      },
      deleteItems(nodeIds: ReadonlySet<string>, edgeIds: ReadonlySet<string> = new Set()) {
        const document = state().document;
        if ([...nodeIds].some((id) => state().generationSubmitting.has(id))) {
          state().notify('任务正在创建，请稍后删除节点');
          return;
        }
        const jobs = document.nodes
          .filter((node) => nodeIds.has(node.id) && !isNodeLocked(document, node))
          .flatMap((node) => {
            if (node.type !== 'image' && node.type !== 'video') return [];
            return (node.data as { pendingJobIds?: string[] } | null)?.pendingJobIds ?? [];
          });
        if (jobs.length && window.confirm('远端可能仍在运行并计费，是否同时放弃生成任务？'))
          for (const id of jobs)
            void host.generation
              ?.cancel(id)
              .catch((error: unknown) =>
                state().notify(error instanceof Error ? error.message : '放弃任务失败'),
              );
        run((current) => deleteElements(current, nodeIds, edgeIds));
      },
      deleteSelection() {
        const { selectedNodes, selectedEdges } = state();
        if (!selectedNodes.size && !selectedEdges.size) return;
        actions.deleteItems(selectedNodes, selectedEdges);
      },
      selectAll() {
        state().select(state().document.nodes.map((node) => node.id));
      },
      copy(): string | null {
        const { document, selectedNodes } = state();
        const payload = copySelection(document, selectedNodes, state().tags);
        if (!payload) return null;
        pasteState.count = 0;
        try {
          return serialize(payload);
        } catch (error) {
          if (error instanceof CanvasCommandError) state().notify(error.message);
          else throw error;
          return null;
        }
      },
      paste(text: string, at?: Point) {
        const payload = deserialize(text, registry);
        if (!payload) return false;
        if (host.tags && state().tags === null) {
          state().notify('标签尚未加载，请稍后重试');
          return false;
        }
        // 连续粘贴到同一位置时依次错开，避免完全重叠。
        const base = at ?? viewportCenter();
        if (pasteState.at && Math.hypot(base.x - pasteState.at.x, base.y - pasteState.at.y) < 1)
          pasteState.count++;
        else pasteState.count = 0;
        pasteState.at = base;
        const instantiated = instantiate(payload, {
          x: base.x + pasteState.count * PASTE_OFFSET,
          y: base.y + pasteState.count * PASTE_OFFSET,
        });
        const { edges } = instantiated;
        const nodes = resolveTags(instantiated.nodes, payload.tags, state().tags ?? []);
        const insert = () => {
          const ok = run((document) => addNodes(document, nodes, edges));
          if (ok) state().select(nodes.filter((node) => !node.parentId).map((node) => node.id));
          return ok;
        };
        if (!host.media.adopt) return insert();
        void adoptMedia(host, nodes)
          .then((missing) => {
            insert();
            if (missing.length) state().notify(`${missing.length} 个素材缺失，已保留引用`);
          })
          .catch((error: unknown) =>
            state().notify(error instanceof Error ? error.message : '补齐媒体失败'),
          );
        return true;
      },
      duplicate() {
        const text = actions.copy();
        if (!text) return;
        const { document, selectedNodes } = state();
        const first = document.nodes.find((node) => selectedNodes.has(node.id))!;
        const roots = document.nodes.filter((node) => selectedNodes.has(node.id) && !node.parentId);
        const anchor = roots.length
          ? {
              x: Math.min(...roots.map((node) => node.position.x)) + PASTE_OFFSET,
              y: Math.min(...roots.map((node) => node.position.y)) + PASTE_OFFSET,
            }
          : { x: first.position.x + PASTE_OFFSET, y: first.position.y + PASTE_OFFSET };
        pasteState.at = null;
        actions.paste(text, anchor);
      },
      group() {
        let groupId = '';
        if (
          run((document) => {
            const result = groupNodes(registry, document, state().selectedNodes);
            groupId = result.groupId;
            return result.document;
          })
        )
          state().select([groupId]);
      },
      ungroup() {
        run((document) => ungroup(document, state().selectedNodes));
      },
      fitGroups() {
        run((document) => {
          let next = document;
          for (const node of document.nodes)
            if (state().selectedNodes.has(node.id) && node.type === 'group')
              next = fitGroup(next, node.id);
          return next;
        });
      },
      arrangeOrder,
      setArrangeOrder,
      arrange(mode: ArrangeMode) {
        run((document) => arrange(document, state().selectedNodes, mode, arrangeOrder));
        requestAnimationFrame(() => void flow.fitView({ duration: 200, padding: 0.15 }));
      },
      nudge(dx: number, dy: number) {
        run((document) => nudge(document, state().selectedNodes, { x: dx, y: dy }));
      },
      reorder(to: 'front' | 'back') {
        run((document) => reorder(document, state().selectedNodes, to));
      },
      setLocked(locked: boolean) {
        run((document) => setLocked(document, state().selectedNodes, locked));
      },
      rename() {
        const [id] = state().selectedNodes;
        const node = state().document.nodes.find((node) => node.id === id);
        if (node && state().selectedNodes.size === 1 && !isNodeLocked(state().document, node))
          state().setEditingTitle(id);
      },
      zoomIn: () => void flow.zoomIn({ duration: 150 }),
      zoomOut: () => void flow.zoomOut({ duration: 150 }),
      zoomTo: (zoom: number) => void flow.zoomTo(zoom, { duration: 150 }),
      fitView: () => void flow.fitView({ duration: 200, padding: 0.15, maxZoom: 1 }),
      undo: () => state().undo(),
      redo: () => state().redo(),
      importFiles(files: Blob[], at: Point = viewportCenter()) {
        imports.start(files, at);
      },
      uploads: imports.tasks,
      retryImport: imports.retry,
      cancelImport: imports.cancel,
      async pickAsset(at: Point = viewportCenter(), nodeId?: string) {
        try {
          const picked = await host.assets?.pick(nodeId ? 'image' : undefined);
          if (!picked) return;
          if (nodeId) {
            const node = state().document.nodes.find((node) => node.id === nodeId);
            if (!node || isNodeLocked(state().document, node)) return;
            run((document) =>
              updateData<CanvasMediaData>(document, nodeId, (data) =>
                appendVersion(data, picked.version),
              ),
            );
          } else {
            const node = createNode(registry, picked.kind, at);
            node.title = picked.name;
            node.data = appendVersion(
              emptyMedia(picked.kind === 'video' ? 'text' : undefined),
              picked.version,
            );
            node.size = fitMediaSize(picked.version.width, picked.version.height, node.size);
            if (run((document) => addNodes(document, [node]))) state().select([node.id]);
          }
        } catch (error) {
          state().notify(error instanceof Error ? error.message : '添加资产失败');
        }
      },
      async saveAsset() {
        const node = state().document.nodes.find((node) => state().selectedNodes.has(node.id));
        if (
          !node ||
          state().selectedNodes.size !== 1 ||
          (node.type !== 'image' && node.type !== 'video')
        )
          return;
        const version = activeVersion(node.data as CanvasMediaData);
        if (!version) return;
        try {
          await host.assets?.save(version);
        } catch (error) {
          state().notify(error instanceof Error ? error.message : '保存资产失败');
        }
      },
      clipboardMime: CLIPBOARD_MIME,
      exportDocument() {
        downloadCanvasDocument(state().document, state().tags);
      },
      async importDocument(file: File) {
        try {
          if (host.tags && state().tags === null)
            throw new CanvasCommandError('标签尚未加载，请稍后重试');
          if (file.size > CANVAS_LIMITS.bytes)
            throw new CanvasCommandError('画布 JSON 不能超过 8 MiB');
          const next = parseDocument(await file.text(), registry, state().tags ?? []);
          const missing = await adoptMedia(host, next.nodes);
          if (run(() => next)) {
            state().select([]);
            state().setEditingTitle(null);
            state().notify(
              missing.length
                ? `已导入画布，${missing.length} 个素材缺失，已保留引用`
                : '已导入画布，可撤销恢复原内容',
            );
          }
        } catch (error) {
          state().notify(error instanceof Error ? error.message : '读取画布 JSON 失败');
        }
      },
    };
    return actions;
  }, [flow, host, registry, store, imports, arrangeOrder]);
}

export type CanvasActionsApi = ReturnType<typeof useCanvasActions>;
