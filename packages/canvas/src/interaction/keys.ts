export type ShortcutAction =
  | 'tool-pointer'
  | 'tool-select'
  | 'tool-hand'
  | 'add-node'
  | 'help'
  | 'toggle-minimap'
  | 'fit-view'
  | 'zoom-reset'
  | 'zoom-in'
  | 'zoom-out'
  | 'select-all'
  | 'deselect'
  | 'delete'
  | 'duplicate'
  | 'rename'
  | 'undo'
  | 'redo'
  | 'group'
  | 'ungroup'
  | 'nudge-left'
  | 'nudge-right'
  | 'nudge-up'
  | 'nudge-down';

type KeyLike = Pick<
  KeyboardEvent,
  | 'key'
  | 'code'
  | 'ctrlKey'
  | 'metaKey'
  | 'shiftKey'
  | 'altKey'
  | 'isComposing'
  | 'keyCode'
  | 'target'
>;

/** 焦点在可编辑元素中，或输入法正在组字时，画布不处理按键。 */
export function shouldIgnore(event: KeyLike): boolean {
  // keyCode 229 是部分输入法组字时的按键事件，isComposing 在组字结束那次按键可能为 false。
  if (event.isComposing || event.keyCode === 229) return true;
  const target = event.target as HTMLElement | null;
  if (!target || typeof target.closest !== 'function') return false;
  return !!target.closest(
    'input, textarea, select, [contenteditable=""], [contenteditable="true"]',
  );
}

/** 把按键映射为画布动作；Ctrl 与 Meta 等价，方便以后跨平台。 */
export function shortcutFor(event: KeyLike): ShortcutAction | null {
  const mod = event.ctrlKey || event.metaKey;
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  if (mod && !event.altKey) {
    if (key === 'z') return event.shiftKey ? 'redo' : 'undo';
    if (key === 'y' && !event.shiftKey) return 'redo';
    if (key === 'a' && !event.shiftKey) return 'select-all';
    if (key === 'd' && !event.shiftKey) return 'duplicate';
    if (key === 'g') return event.shiftKey ? 'ungroup' : 'group';
    if (key === '=' || key === '+' || event.code === 'NumpadAdd') return 'zoom-in';
    if (key === '-' || event.code === 'NumpadSubtract') return 'zoom-out';
    if (key === '0') return 'zoom-reset';
    return null;
  }
  if (event.altKey || event.metaKey || event.ctrlKey) return null;
  if (event.shiftKey) {
    if (event.code === 'Digit1') return 'fit-view';
    if (event.code === 'Digit0') return 'zoom-reset';
  }
  const step = {
    ArrowLeft: 'nudge-left',
    ArrowRight: 'nudge-right',
    ArrowUp: 'nudge-up',
    ArrowDown: 'nudge-down',
  } as const;
  if (key in step) return step[key as keyof typeof step];
  if (event.shiftKey) return key === '?' ? 'help' : null;
  switch (key) {
    case 'v':
      return 'tool-pointer';
    case 'b':
      return 'tool-select';
    case 'h':
      return 'tool-hand';
    case 'n':
      return 'add-node';
    case 'm':
      return 'toggle-minimap';
    case '?':
      return 'help';
    case 'Escape':
      return 'deselect';
    case 'Delete':
    case 'Backspace':
      return 'delete';
    case 'F2':
      return 'rename';
    default:
      return null;
  }
}

export const SHORTCUT_HELP: { group: string; items: [string, string][] }[] = [
  {
    group: '工具',
    items: [
      ['V', '指针'],
      ['B', '框选'],
      ['H', '抓手'],
      ['按住 Space', '临时平移'],
      ['N', '添加节点'],
    ],
  },
  {
    group: '视图',
    items: [
      ['滚轮', '以光标为中心缩放'],
      ['Ctrl + = / -', '放大 / 缩小'],
      ['Shift + 1', '适应视图'],
      ['Shift + 0', '缩放到 100%'],
      ['M', '显示 / 隐藏小地图'],
    ],
  },
  {
    group: '编辑',
    items: [
      ['Ctrl + C / X / V', '复制 / 剪切 / 粘贴'],
      ['Ctrl + D', '原地复制'],
      ['Delete', '删除'],
      ['F2', '重命名'],
      ['Ctrl + Z', '撤销'],
      ['Ctrl + Shift + Z', '重做'],
      ['Ctrl + G', '分组'],
      ['Ctrl + Shift + G', '解组'],
      ['方向键', '微移 1px，按住 Shift 为 10px'],
      ['Ctrl + A', '全选'],
      ['Esc', '取消选择'],
    ],
  },
];
