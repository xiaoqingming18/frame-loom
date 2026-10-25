import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useViewport } from '@xyflow/react';
import {
  Cable,
  ChevronDown,
  CircleHelp,
  Hand,
  LayoutGrid,
  Map as MapIcon,
  MousePointer2,
  Plus,
  Redo2,
  Rows3,
  Shapes,
  SquareDashedMousePointer,
  Undo2,
  Upload,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@frame-loom/ui/components/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@frame-loom/ui/components/dialog';
import type { CanvasEdgeDisplay } from '@frame-loom/contracts';
import { useCanvas, useCanvasState } from '../context';
import { SHORTCUT_HELP } from '../interaction/keys';
import type { CanvasTool } from '../store/store';
import { ToolbarButton, ToolbarDivider } from './toolbar-button';
import type { CanvasActionsApi, PendingConnection } from './use-actions';
import type { Point } from '../commands/commands';
import { IMAGE_MIME, VIDEO_MIME } from '../interaction/media-import';

/** 添加节点菜单的条目由注册表生成，不显示未实现的类型。 */
export function AddNodeItems({
  actions,
  at,
  pending,
  accepts,
}: {
  actions: CanvasActionsApi;
  at?: Point;
  pending?: PendingConnection;
  accepts?: (type: string) => boolean;
}) {
  const { registry } = useCanvas();
  const types = registry.list().filter((type) => type.category && (!accepts || accepts(type.type)));
  if (!types.length)
    return (
      <DropdownMenuLabel className="font-normal text-muted-foreground">
        没有可连接的节点类型
      </DropdownMenuLabel>
    );
  return types.map((type) => (
    <DropdownMenuItem key={type.type} onSelect={() => actions.addNode(type.type, at, pending)}>
      <span aria-hidden="true">{type.icon}</span>
      {type.label}
    </DropdownMenuItem>
  ));
}

const tools: { id: CanvasTool; label: string; shortcut: string; icon: ReactNode }[] = [
  { id: 'pointer', label: '指针', shortcut: 'V', icon: <MousePointer2 /> },
  { id: 'select', label: '框选', shortcut: 'B', icon: <SquareDashedMousePointer /> },
  { id: 'hand', label: '抓手', shortcut: 'H', icon: <Hand /> },
];

export function BottomDock({
  actions,
  addOpen,
  onAddOpenChange,
  onHelp,
}: {
  actions: CanvasActionsApi;
  addOpen: boolean;
  onAddOpenChange: (open: boolean) => void;
  onHelp: () => void;
}) {
  const { store } = useCanvas();
  const input = useRef<HTMLInputElement>(null);
  const tool = useCanvasState((state) => state.tool);
  const canUndo = useCanvasState((state) => state.past.length > 0);
  const canRedo = useCanvasState((state) => state.future.length > 0);
  return (
    <div
      role="toolbar"
      aria-label="画布工具"
      className="canvas-float absolute bottom-6 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-xl bg-popover p-1.5 shadow-canvas-dock"
    >
      <input
        ref={input}
        type="file"
        multiple
        accept={[...IMAGE_MIME, ...VIDEO_MIME].join(',')}
        aria-label="上传图片或视频"
        className="hidden"
        onChange={(event) => {
          const files = [...(event.target.files ?? [])];
          if (files.length) void actions.importFiles(files);
          event.target.value = '';
        }}
      />
      <DropdownMenu open={addOpen} onOpenChange={onAddOpenChange}>
        <DropdownMenuTrigger asChild>
          <ToolbarButton label="添加节点" shortcut="N" primary>
            <Plus strokeWidth={2} />
          </ToolbarButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start" sideOffset={10}>
          <DropdownMenuLabel>添加节点</DropdownMenuLabel>
          <AddNodeItems actions={actions} />
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => input.current?.click()}>
            <Upload aria-hidden="true" />
            上传图片或视频
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {tools.map((item) => (
        <ToolbarButton
          key={item.id}
          label={item.label}
          shortcut={item.shortcut}
          active={tool === item.id}
          onClick={() => store.getState().setTool(item.id)}
        >
          {item.icon}
        </ToolbarButton>
      ))}
      <ToolbarDivider />
      <ToolbarButton label="撤销" shortcut="Ctrl+Z" disabled={!canUndo} onClick={actions.undo}>
        <Undo2 />
      </ToolbarButton>
      <ToolbarButton
        label="重做"
        shortcut="Ctrl+Shift+Z"
        disabled={!canRedo}
        onClick={actions.redo}
      >
        <Redo2 />
      </ToolbarButton>
      <ToolbarDivider />
      <ToolbarButton label="快捷键帮助" shortcut="?" onClick={onHelp}>
        <CircleHelp />
      </ToolbarButton>
    </div>
  );
}

const zoomSteps = [0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4];
const edgeOptions: { id: CanvasEdgeDisplay; label: string }[] = [
  { id: 'all', label: '全部显示' },
  { id: 'related', label: '仅选中相关' },
  { id: 'hidden', label: '隐藏' },
];

export function ArrangeItems({ actions }: { actions: CanvasActionsApi }) {
  return (
    <>
      <DropdownMenuItem onSelect={() => actions.arrange('grid')}>
        <LayoutGrid aria-hidden="true" />
        宫格
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => actions.arrange('horizontal')}>
        <Rows3 aria-hidden="true" className="rotate-90" />
        水平
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => actions.arrange('vertical')}>
        <Rows3 aria-hidden="true" />
        垂直
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => actions.arrange('type')}>
        <Shapes aria-hidden="true" />
        按类型
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuLabel>排序方式</DropdownMenuLabel>
      <DropdownMenuRadioGroup
        value={actions.arrangeOrder}
        onValueChange={(value) => actions.setArrangeOrder(value as 'created' | 'title')}
      >
        <DropdownMenuRadioItem value="created">创建顺序</DropdownMenuRadioItem>
        <DropdownMenuRadioItem value="title">标题顺序</DropdownMenuRadioItem>
      </DropdownMenuRadioGroup>
    </>
  );
}

export function TopRightBar({ actions, compact }: { actions: CanvasActionsApi; compact: boolean }) {
  const { store } = useCanvas();
  const { zoom } = useViewport();
  const minimap = useCanvasState((state) => state.view.minimap);
  const edgeDisplay = useCanvasState((state) => state.view.edgeDisplay);
  const hasSelection = useCanvasState((state) => state.selectedNodes.size > 0);
  const scope = hasSelection ? '选中节点' : '全部节点';
  return (
    <div
      role="toolbar"
      aria-label="视图与整理"
      className="canvas-float flex items-center gap-0.5 rounded-lg bg-popover p-1 shadow-canvas-bar"
    >
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <ToolbarButton label="缩放比例" size="bar" className="w-14 tabular-nums">
            {Math.round(zoom * 100)}%
          </ToolbarButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" sideOffset={8}>
          <DropdownMenuItem onSelect={actions.fitView}>
            适应视图<DropdownMenuShortcut>Shift+1</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => actions.zoomTo(1)}>
            100%<DropdownMenuShortcut>Shift+0</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={actions.zoomIn}>
            放大<DropdownMenuShortcut>Ctrl+=</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={actions.zoomOut}>
            缩小<DropdownMenuShortcut>Ctrl+-</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {zoomSteps.map((step) => (
            <DropdownMenuItem key={step} onSelect={() => actions.zoomTo(step)}>
              {step * 100}%
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <ToolbarDivider size="bar" />
      <ToolbarButton
        label={`按类型整理${scope}`}
        size="bar"
        onClick={() => actions.arrange('type')}
      >
        <Shapes />
      </ToolbarButton>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <ToolbarButton label={`按布局整理${scope}`} size="bar">
            <LayoutGrid />
            <ChevronDown className="size-3!" />
          </ToolbarButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" sideOffset={8}>
          <DropdownMenuLabel>整理{scope}</DropdownMenuLabel>
          <ArrangeItems actions={actions} />
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <ToolbarButton label="连线显示" size="bar" active={edgeDisplay !== 'all'}>
            <Cable />
            <ChevronDown className="size-3!" />
          </ToolbarButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" sideOffset={8}>
          <DropdownMenuLabel>连线显示</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={edgeDisplay}
            onValueChange={(value) => store.getState().setEdgeDisplay(value as CanvasEdgeDisplay)}
          >
            {edgeOptions.map((option) => (
              <DropdownMenuRadioItem key={option.id} value={option.id}>
                {option.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <ToolbarButton
        label={minimap ? '隐藏小地图' : '显示小地图'}
        shortcut="M"
        size="bar"
        active={minimap && !compact}
        disabled={compact}
        onClick={() => store.getState().setView({ minimap: !minimap })}
      >
        <MapIcon />
        {!compact && '小地图'}
      </ToolbarButton>
    </div>
  );
}

export function EmptyHint() {
  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-6 text-foreground select-none">
      <p className="flex items-center gap-2 text-lg font-semibold">
        <MousePointer2 aria-hidden="true" className="size-6 fill-brand text-brand" />
        双击画布　自由生成节点
      </p>
      <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
        按住 <kbd className="canvas-keycap">Space</kbd> 拖拽画布，滚动
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="size-3.5 fill-none stroke-current stroke-[1.5]"
        >
          <rect x="5" y="2" width="14" height="20" rx="7" />
          <line x1="12" y1="6" x2="12" y2="10" />
        </svg>
        缩放画布
      </p>
    </div>
  );
}

export function HelpDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>画布快捷键</DialogTitle>
          <DialogDescription>在输入框内编辑或输入法组字时，画布快捷键不会生效。</DialogDescription>
        </DialogHeader>
        {SHORTCUT_HELP.map((group) => (
          <section key={group.group} className="space-y-2">
            <h3 className="text-xs font-medium text-muted-foreground">{group.group}</h3>
            <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-6 gap-y-1.5 text-sm">
              {group.items.map(([keys, label]) => (
                <div key={keys} className="contents">
                  <dt>{label}</dt>
                  <dd className="text-right">
                    <kbd className="canvas-keycap">{keys}</kbd>
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </DialogContent>
    </Dialog>
  );
}

/** 画布内的短暂提示；屏幕阅读器通过 status 区域读出。 */
export function Notice() {
  const notice = useCanvasState((state) => state.notice);
  const [expired, setExpired] = useState<number | null>(null);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setExpired(notice.id), 3200);
    return () => clearTimeout(timer);
  }, [notice]);
  const visible = notice && notice.id !== expired ? notice : null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none absolute top-4 left-1/2 z-20 -translate-x-1/2"
    >
      {visible && (
        <p className="rounded-lg border bg-popover px-3 py-2 text-sm text-foreground shadow-canvas-bar">
          {visible.text}
        </p>
      )}
    </div>
  );
}
