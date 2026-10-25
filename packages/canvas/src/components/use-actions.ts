import { useMemo } from 'react';
import { useReactFlow } from '@xyflow/react';
import type { CanvasDocument, CanvasMediaData, CanvasNode } from '@frame-loom/contracts';
import { useCanvas } from '../context';
import {
  addNodes,
  CanvasCommandError,
  connect,
  createNode,
  deleteElements,
  groupNodes,
  nudge,
  reorder,
  setLocked,
  ungroup,
  type Point,
} from '../commands/commands';
import { arrange, type ArrangeMode } from '../layout/layout';
import {
  copySelection,
  deserialize,
  instantiate,
  serialize,
  CLIPBOARD_MIME,
} from '../interaction/clipboard';
import { importMedia, mediaKind } from '../interaction/media-import';
import { fitMediaSize } from '../nodes/media';

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

  return useMemo(() => {
    const state = () => store.getState();
    const run = (change: (document: CanvasDocument) => CanvasDocument) => {
      try {
        state().apply(change);
        return true;
      } catch (error) {
        if (error instanceof CanvasCommandError) state().notify(error.message);
        else throw error;
        return false;
      }
    };
    const viewportCenter = (): Point => {
      const pane = document.querySelector('.react-flow');
      const rect = pane?.getBoundingClientRect();
      return flow.screenToFlowPosition({
        x: (rect?.left ?? 0) + (rect?.width ?? 0) / 2,
        y: (rect?.top ?? 0) + (rect?.height ?? 0) / 2,
      });
    };
    // 连续粘贴的偏移计数只在事件处理中读写，不参与渲染。
    const pasteState = { count: 0, at: null as Point | null };

    const actions = {
      addNode(type: string, at: Point = viewportCenter(), pending?: PendingConnection) {
        const node = createNode(registry, type, at);
        let ok = run((document) => addNodes(document, [node]));
        if (ok && pending) {
          const source = pending.handleType === 'source';
          const port = source ? registry.inputs(node)[0] : registry.outputs(node)[0];
          if (port)
            ok = run((document) =>
              connect(registry, document, {
                source: source ? pending.nodeId : node.id,
                sourceHandle: source ? pending.handleId : port.id,
                target: source ? node.id : pending.nodeId,
                targetHandle: source ? port.id : pending.handleId,
              }),
            );
        }
        if (ok) state().select([node.id]);
        return node.id;
      },
      deleteSelection() {
        const { selectedNodes, selectedEdges } = state();
        if (!selectedNodes.size && !selectedEdges.size) return;
        run((document) => deleteElements(document, selectedNodes, selectedEdges));
      },
      selectAll() {
        state().select(state().document.nodes.map((node) => node.id));
      },
      copy(cut = false): string | null {
        const { document, selectedNodes } = state();
        const payload = copySelection(document, selectedNodes);
        if (!payload) return null;
        if (cut) run((current) => deleteElements(current, selectedNodes));
        pasteState.count = 0;
        return serialize(payload);
      },
      paste(text: string, at?: Point) {
        const payload = deserialize(text);
        if (!payload) return false;
        // 连续粘贴到同一位置时依次错开，避免完全重叠。
        const base = at ?? viewportCenter();
        if (pasteState.at && Math.hypot(base.x - pasteState.at.x, base.y - pasteState.at.y) < 1)
          pasteState.count++;
        else pasteState.count = 0;
        pasteState.at = base;
        const { nodes, edges } = instantiate(payload, {
          x: base.x + pasteState.count * PASTE_OFFSET,
          y: base.y + pasteState.count * PASTE_OFFSET,
        });
        if (run((document) => addNodes(document, nodes, edges)))
          state().select(nodes.filter((node) => !node.parentId).map((node) => node.id));
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
      arrange(mode: ArrangeMode) {
        run((document) => arrange(document, state().selectedNodes, mode));
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
        if (id && state().selectedNodes.size === 1) state().setEditingTitle(id);
      },
      zoomIn: () => void flow.zoomIn({ duration: 150 }),
      zoomOut: () => void flow.zoomOut({ duration: 150 }),
      zoomTo: (zoom: number) => void flow.zoomTo(zoom, { duration: 150 }),
      fitView: () => void flow.fitView({ duration: 200, padding: 0.15, maxZoom: 1 }),
      undo: () => state().undo(),
      redo: () => state().redo(),
      /** 上传文件并在指定位置建节点；多个文件依次向右排开。 */
      async importFiles(files: Blob[], at: Point = viewportCenter()) {
        const supported = files.filter((file) => mediaKind(file));
        if (supported.length < files.length)
          state().notify('已忽略不支持的文件，只支持 PNG、JPEG、WebP 图片和 MP4、MOV 视频');
        let x = at.x;
        const created: string[] = [];
        for (const file of supported) {
          const kind = mediaKind(file)!;
          const definition = registry.get(kind)!;
          const node: CanvasNode = createNode(registry, kind, { x, y: at.y });
          node.title =
            file instanceof File && file.name ? file.name.slice(0, 200) : definition.label;
          x += node.size.width + 40;
          try {
            const { version } = await importMedia(host, file);
            const size = fitMediaSize(version.width, version.height, definition.defaultSize);
            node.size = size;
            node.position = { x: node.position.x, y: Math.round(at.y - size.height / 2) };
            node.data = {
              ...(node.data as CanvasMediaData),
              versions: [version],
              activeVersion: 0,
            };
            if (run((document) => addNodes(document, [node]))) created.push(node.id);
          } catch (error) {
            state().notify(error instanceof Error ? `导入失败：${error.message}` : '导入失败');
          }
        }
        if (created.length) state().select(created);
      },
      clipboardMime: CLIPBOARD_MIME,
    };
    return actions;
  }, [flow, host, registry, store]);
}

export type CanvasActionsApi = ReturnType<typeof useCanvasActions>;
