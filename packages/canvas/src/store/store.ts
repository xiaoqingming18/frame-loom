import { createStore } from 'zustand/vanilla';
import {
  emptyCanvasDocument,
  type CanvasDocument,
  type CanvasEdgeDisplay,
  type CanvasView,
} from '@frame-loom/contracts';

export type CanvasTool = 'pointer' | 'select' | 'hand';
export const HISTORY_LIMIT = 100;
export const DEFAULT_VIEW: CanvasView = {
  viewport: { x: 0, y: 0, zoom: 1 },
  minimap: true,
  edgeDisplay: 'all',
};

export interface CanvasState {
  document: CanvasDocument;
  past: CanvasDocument[];
  future: CanvasDocument[];
  /** 拖拽、调整尺寸等连续操作开始时的文档，结束时合并为一步历史。 */
  transaction: CanvasDocument | null;
  selectedNodes: ReadonlySet<string>;
  selectedEdges: ReadonlySet<string>;
  hoveredNode: string | null;
  editingTitle: string | null;
  tool: CanvasTool;
  spaceHeld: boolean;
  view: CanvasView;
  notice: { id: number; text: string } | null;
}

export interface CanvasActions {
  /** 用纯函数修改文档；默认记一步历史，返回值与原文档相同则不记录。 */
  apply(change: (document: CanvasDocument) => CanvasDocument, options?: { record?: boolean }): void;
  begin(): void;
  commit(): void;
  /** 生成任务回写等系统修改：同步改写当前文档与全部历史快照，不形成撤销步骤。 */
  applySystem(change: (document: CanvasDocument) => CanvasDocument): void;
  /** 外部重新加载文档时清空历史。 */
  reset(document: CanvasDocument, view?: CanvasView | null): void;
  undo(): void;
  redo(): void;
  select(nodes: Iterable<string>, edges?: Iterable<string>): void;
  setHovered(id: string | null): void;
  setEditingTitle(id: string | null): void;
  setTool(tool: CanvasTool): void;
  setSpaceHeld(held: boolean): void;
  setView(patch: Partial<CanvasView>): void;
  setEdgeDisplay(display: CanvasEdgeDisplay): void;
  notify(text: string): void;
}

export type CanvasStore = ReturnType<typeof createCanvasStore>;

let noticeId = 0;

export function createCanvasStore(
  document: CanvasDocument = emptyCanvasDocument(),
  view: CanvasView | null = null,
) {
  return createStore<CanvasState & CanvasActions>()((set, get) => ({
    document,
    past: [],
    future: [],
    transaction: null,
    selectedNodes: new Set(),
    selectedEdges: new Set(),
    hoveredNode: null,
    editingTitle: null,
    tool: 'pointer',
    spaceHeld: false,
    view: view ?? DEFAULT_VIEW,
    notice: null,
    apply(change, { record = true } = {}) {
      const { document: current, past, transaction } = get();
      const next = change(current);
      if (next === current) return;
      if (!record || transaction) set({ document: next });
      else set({ document: next, past: [...past, current].slice(-HISTORY_LIMIT), future: [] });
      pruneSelection(set, get);
    },
    begin() {
      if (!get().transaction) set({ transaction: get().document });
    },
    commit() {
      const { transaction, document: current, past } = get();
      if (!transaction) return;
      if (transaction === current) set({ transaction: null });
      else
        set({
          transaction: null,
          past: [...past, transaction].slice(-HISTORY_LIMIT),
          future: [],
        });
    },
    applySystem(change) {
      const { document: current, past, future, transaction } = get();
      set({
        document: change(current),
        past: past.map(change),
        future: future.map(change),
        transaction: transaction && change(transaction),
      });
      pruneSelection(set, get);
    },
    reset(next, nextView) {
      set({
        document: next,
        past: [],
        future: [],
        transaction: null,
        selectedNodes: new Set(),
        selectedEdges: new Set(),
        editingTitle: null,
        ...(nextView ? { view: nextView } : {}),
      });
    },
    undo() {
      const { past, future, document: current, transaction } = get();
      if (transaction || !past.length) return;
      set({ document: past.at(-1)!, past: past.slice(0, -1), future: [current, ...future] });
      pruneSelection(set, get);
    },
    redo() {
      const { past, future, document: current, transaction } = get();
      if (transaction || !future.length) return;
      set({ document: future[0], future: future.slice(1), past: [...past, current] });
      pruneSelection(set, get);
    },
    select(nodes, edges = []) {
      set({ selectedNodes: new Set(nodes), selectedEdges: new Set(edges) });
    },
    setHovered(id) {
      if (get().hoveredNode !== id) set({ hoveredNode: id });
    },
    setEditingTitle(id) {
      set({ editingTitle: id });
    },
    setTool(tool) {
      set({ tool });
    },
    setSpaceHeld(held) {
      if (get().spaceHeld !== held) set({ spaceHeld: held });
    },
    setView(patch) {
      set({ view: { ...get().view, ...patch } });
    },
    setEdgeDisplay(edgeDisplay) {
      set({ view: { ...get().view, edgeDisplay } });
    },
    notify(text) {
      set({ notice: { id: ++noticeId, text } });
    },
  }));
}

type Setter = (partial: Partial<CanvasState>) => void;
function pruneSelection(set: Setter, get: () => CanvasState) {
  const { document, selectedNodes, selectedEdges } = get();
  const nodes = new Set(document.nodes.map((node) => node.id));
  const edges = new Set(document.edges.map((edge) => edge.id));
  const keptNodes = [...selectedNodes].filter((id) => nodes.has(id));
  const keptEdges = [...selectedEdges].filter((id) => edges.has(id));
  if (keptNodes.length !== selectedNodes.size || keptEdges.length !== selectedEdges.size)
    set({ selectedNodes: new Set(keptNodes), selectedEdges: new Set(keptEdges) });
}
