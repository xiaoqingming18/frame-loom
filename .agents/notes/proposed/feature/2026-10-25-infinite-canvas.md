# Agent Note: 无限画布（独立包、节点注册表、类型化连线）

Status: proposed

## Problem

Frame Loom 的创作流程（参考图 → 图片 → 视频，以及后续的文本、音频、导演台、视频剪辑）需要一个无限画布：节点承载素材和生成位，连线表达"谁是谁的参考"。现在 renderer 只有静态页面和临时的模型测试页，没有任何画布能力。

需求与约束：

- 画布以后与项目管理联动，但项目管理尚未实现。画布功能与界面要放在一个独立 package 中，主工程左栏新增「画布测试」菜单和页面供人工验收。
- 首期节点为图片与视频；架构要能低成本新增文本、音频、导演台、视频剪辑等节点。
- 节点之间可以连线，连线必须做类型校验（图片不能连到只收音频的端口等）。视频节点按三种生成方式（文生视频、首尾帧、参考生视频）决定可用端口，连线本身不带角色。
- 底部操作栏提供新增节点、指针、框选、抓手等工具；支持按住空格平移、复制粘贴、滚轮缩放等快捷键。
- 支持分组、整理（按类型、宫格／水平／垂直）、连线显示开关，右上角提供小地图。
- 画布必须使用现有主题系统：颜色只来自 `apps/desktop/src/renderer/src/styles/theme.css`，跟随 `prefers-color-scheme`，明暗两种模式都要检查（[UI 规范](../../../../docs/ui-guidelines.md)）。
- 视觉风格参考 `docs/design/canvas-ui-light.html` 快照；其底部操作栏元素与本篇不同时以本篇为准。
- 现有约束：
  - engine 退出时主进程调用 `webContents.reload()` 整页重载，这是[桌面壳](../../implemented/architecture/2026-10-24-desktop-shell.md)明确标注的捷径，引入可编辑业务页面时必须改为类型化事件。画布是第一个这样的页面。
  - 默认应用菜单在生产包中仍保留重载、开发者工具与页面缩放快捷键（[主题与外壳](../../implemented/feature/2026-10-24-theme-and-app-shell.md)），会与画布快捷键冲突，Ctrl+R 还会丢失未保存内容。
  - 生产 CSP 的 `img-src`／`media-src` 只允许 `'self'` 与 `frame-media:`，不允许 `blob:`；媒体按 sha256 由 `POST /media` 落盘、经 `frame-media://` 读取（[模型管理](../architecture/2026-10-24-model-management.md)）。
  - shadcn 组件位于 `apps/desktop/src/renderer/src/components/ui`，独立包不能反向导入 app。
  - 窗口最小 720×560，减去 260px 侧栏后画布最窄约 460px。

## Proposal

### 调研依据

2026-10-25 的调研结论，属于记录时的事实，上游可能变化：

- **[@xyflow/react](https://reactflow.dev/api-reference/react-flow) 12.12.0**（MIT，npm 2026-10-11 更新，peer `react>=17`，依赖 `zustand ^4.4.0`）：节点是 DOM；内置 `panActivationKeyCode`（默认 Space）、`selectionOnDrag`、`panOnDrag` 鼠标键数组、`isValidConnection`、`parentId` 子流、`NodeResizer`、[`MiniMap`](https://reactflow.dev/api-reference/components/minimap)（`position`、`pannable`、`zoomable`、`nodeColor` 函数）、`--xy-*` CSS 变量与 `base.css`（[Theming](https://reactflow.dev/learn/customization/theming)）、`ariaLabelConfig`、`onlyRenderVisibleElements`。默认 `minZoom` 0.5、`maxZoom` 2、`deleteKeyCode` 只有 Backspace。复制粘贴、撤销重做、自动布局、选区分组是 Pro 付费示例（[示例列表](https://reactflow.dev/examples)），需要自研。
- **本机 MiniMax Design 4.0.4**（只读解包 `D:\Program Files\hailuo\MiniMax Design\current\resources`）：
  - 画布用 fork 的 `@xyflow/react`（新增拖拽吸附钩子）和 dagre；legacy 与 V3 两套画布并存，每个项目创建时固定一套。
  - 每个节点左侧一个输入、右侧一个输出；校验禁止自连、重复边、分组框和贴纸参与连线；连线时把源资源写进目标的参考列表；拖线到空白处松手弹出添加菜单并自动连上。
  - 连线、背景和小地图画在 Canvas2D 上合批绘制，节点数超过 50 时开启 `onlyRenderVisibleElements`。
  - 快捷键：V／H／Space、Ctrl+G 与 Ctrl+Shift+G、Ctrl+D、F2、M 开关小地图、Shift+1 适配视图、方向键微移；缩放 0.1–4；`deleteKeyCode=null` 自管删除。
  - 整理分水平、垂直、网格、瀑布流，有连线的连通分量交给 dagre 从左到右排；分组是 frame 节点加 `parentId`，7 种颜色；对齐线 5px 吸附。连线显示分 `all/manual/none`。
  - V3 文档为 `{schemaVersion, revision, nodes, edges}`，写入带修改前的值和 revision，冲突返回 409；视图状态（视口、小地图、连线显示）存在 localStorage，不进文档。
- **[basketikun/infinite-canvas](https://github.com/basketikun/infinite-canvas)**（MIT）：自写 `translate + scale` 视口，没有使用图库。`web/src/lib/canvas/node-registry.ts` 与 `web/src/types/canvas-plugin.ts` 的节点定义包含 `defaultSize`、`resource()`、`hasSourceHandle`、`minimapColor`；[快捷键文档](https://github.com/basketikun/infinite-canvas/blob/main/docs/content/docs/canvas/canvas-shortcuts.mdx)的撤销覆盖节点、连线和视口。连线 `{fromNodeId, toNodeId}` 不带端口，参考用途靠节点类型硬编码推断，节点 metadata 是一个大杂烩对象。[tigerowo/infinite-canvas](https://github.com/tigerowo/infinite-canvas) 有导演台，但是 AGPL-3.0。
- **其他**：tldraw 5.5.2 生产环境必须有 license key，否则 5 秒后停止渲染（[说明](https://tldraw.dev/sdk-features/license-key)）；Excalidraw 不支持自定义元素（[#4957](https://github.com/excalidraw/excalidraw/issues/4957)）；ComfyUI 前端为 GPL-3.0，整图快照撤销、`MAX_HISTORY=50`；Dify 用 React Flow 加 zundo；Flora 在生成时才检查上游是否就绪（[文档](https://docs.flora.ai/editor/canvas)）；Weavy 按端口数据类型着色。Chromium 单页的媒体播放器数量有上限，大量 `<video>` 必须按需挂载。

### 包与分层

```text
packages/ui/                      @frame-loom/ui：shadcn 组件与 cn()
packages/canvas/                  @frame-loom/canvas
  src/
    model/        文档类型、id、schema 版本迁移、未知节点类型降级
    registry/     defineNodeType、端口数据类型、兼容判定
    store/        zustand vanilla store：文档、历史、选择、工具、视图状态
    commands/     增删、连线、分组、整理、粘贴、切换生成方式等可撤销命令
    layout/       grid／horizontal／vertical／byType 纯函数
    interaction/  工具状态机、快捷键层、剪贴板、拖入文件
    components/   CanvasEditor、BottomDock、TopRightBar、MiniMap、AddNodeMenu、
                  GroupNode、ContextMenu、EmptyHint
    nodes/        image/、video/：视图、data schema、端口声明
    host.ts       CanvasHost 宿主接口
    styles.css    --xy-* 到主题 token 的映射与画布专用样式
apps/desktop/src/renderer/src/features/canvas-lab/   宿主实现与测试页
```

- **`packages/ui`**：P0 用纯迁移把 `components/ui/*` 与 `lib/utils.ts` 的 `cn` 移入，desktop 改为从 `@frame-loom/ui/...` 导入；包内也用包名自引用，`components.json` 随包迁移，沿用 shadcn monorepo 约定。`theme.css` 留在 desktop：主进程窗口背景测试直接解析它，画布包只使用语义类与 `var(--…)`。
- **以源码形式导出**：两个包的 `exports` 指向 `src`，由 desktop 的 electron-vite 编译 TSX 和 CSS，不单独产出 `dist`；desktop `globals.css` 增加 `@source` 指向两个包的 `src`，并导入 `@frame-loom/canvas/styles.css`。每个包自带 `typecheck`（Bundler、DOM、`react-jsx`）和 vitest（canvas 用 jsdom）。
- **依赖方向**：`apps/desktop` → `@frame-loom/canvas` → `@frame-loom/ui`、`@frame-loom/contracts`。画布包 never 导入 desktop、engine client、TanStack Router 或 Query；需要的能力由宿主注入：

  ```ts
  interface CanvasHost {
    media: {
      upload(file: Blob, signal?: AbortSignal): Promise<MediaFile>;
      url(sha256: string): string; // frame-media://<sha256>
    };
    documents: {
      load(id: string): Promise<CanvasRecord | null>;
      save(id: string, revision: number, document: CanvasDocument): Promise<{ revision: number }>;
      saveView(id: string, view: CanvasView): Promise<void>;
    };
    generation?: CanvasGenerationHost; // P5 接入
  }
  ```

  `features/canvas-lab` 用 EngineClient 与 Query 实现宿主；项目管理落地后复用同一个包，只替换宿主实现。
- **ESLint**：renderer 的 React Hooks、Fast Refresh、Tailwind correctness 与颜色限制规则扩展到 `packages/ui/**`、`packages/canvas/**`；新增导入边界，`packages/*` 不能导入 `apps/*`，`packages/ui` 不能导入 `packages/canvas`。
- **新增依赖**精确锁定：`@xyflow/react` 12.12.0、`zustand` 5.0.16（画布包自用；xyflow 内部另带 zustand 4，打包后多一份约 3 KB）。id 用 `crypto.randomUUID()`，快捷键自写，不引入热键库。dagre 留到"按依赖分层"再评估。

### 文档模型

`packages/contracts` 新增 `canvas.ts`，engine 与画布包共用外层 schema：

```ts
type CanvasDocument = {
  schemaVersion: 1;
  nodes: CanvasNode[]; // 父节点必须排在子节点之前（xyflow 要求）
  edges: CanvasEdge[];
};
type CanvasNode = {
  id: string;
  type: string;        // 'image' | 'video' | 'group' | 以后的类型
  typeVersion: number;
  position: { x: number; y: number }; // 有 parentId 时为相对父节点的坐标
  size: { width: number; height: number };
  parentId?: string;
  title?: string;
  locked?: boolean;
  data: unknown;       // 由注册表中该类型的 schema 校验
};
type CanvasEdge = { id: string; source: string; target: string; sourceHandle: string; targetHandle: string };
type CanvasView = { viewport: { x: number; y: number; zoom: number }; minimap: boolean; edgeDisplay: 'all' | 'related' | 'hidden' };
```

- 媒体节点只保存 sha256 引用，never 保存 base64、data URL 或 blob URL。粘贴和拖入的文件先 `POST /media`，再用 `frame-media://` 显示；复制节点就是复制引用，媒体天然去重。
- 图片／视频节点 `data`：

  ```ts
  {
    versions: { sha256: string; mime: string; width: number; height: number;
                durationMs?: number; posterSha256?: string; jobId?: string; createdAt: string }[];
    activeVersion: number;       // 下游引用的始终是当前版本
    prompt: string;
    mode?: 'text' | 'frames' | 'reference'; // 仅视频
    inputOrder: string[];        // 多参考的顺序，元素为边 id
    modelId?: string; params?: Record<string, string | number | boolean>; // P5
    pendingJobId?: string;       // P5
  }
  ```

- 视图状态 `CanvasView` 不进文档、不计入撤销、不参与 revision。
- 遇到未注册的节点类型时显示占位节点并原样保留 `data`；`typeVersion` 配合注册表的 `migrate()` 演进节点数据。
- 上限：每个文档最多 2000 个节点、4000 条边，序列化后不超过 8 MiB；超出时拒绝操作并提示。

### 节点注册表与连线校验

03 的实现边界：`defineNodeType` 保留数据类型推导，`NodeRegistry` 集中声明与查询端口；未注册、版本不匹配或 data 无效的节点显示占位并禁连线。`migrate` 当前只定义演进接口，尚无旧版本数据迁移。所有编辑提交在 store 检查节点数、边数和 UTF-8 文档体积；命令错误提示并返回 false，保留原文档和历史。剪贴板先校验内置 data、父子顺序与边 id，再按注册表校验内部连线；建节点并自动连线合并为一步撤销。

上传任务及取消／重试状态只存在内存，占位节点不进入文档或撤销栈；媒体上传成功才提交一次建节点操作。视频封面通过已上传媒体抽帧，`frame-media` 启用 CORS 并仅返回当前可信 renderer origin，不反射外部 Origin，不放宽生产 CSP。代价是每次编辑需要序列化文档做体积检查，大规模拖拽性能待总体验收；抽帧失败仍可导入无封面的视频节点。

```ts
defineNodeType({
  type: 'video', version: 1, label: '视频', icon: Film, category: 'media',
  defaultSize: { width: 360, height: 240 }, minSize: { width: 200, height: 140 }, keepAspect: true,
  dataSchema, createData, migrate,
  inputs: (data) => videoPorts[data.mode],                 // 端口随生成方式变化
  outputs: [{ id: 'out', dataType: 'video' }],
  output: (node) => activeAsset(node) && { kind: 'video', sha256: activeAsset(node).sha256 },
  View, minimapToken: '--canvas-type-video',
});
```

端口数据类型首期为 `image | video | audio | text`，`text`、`audio` 暂无节点使用，供后续节点声明。每个输入端口声明 `accepts`（数据类型列表）与 `max`（条数）：

| 节点与方式 | 输入端口 | accepts | max |
| --- | --- | --- | --- |
| 图片 | `reference` | image | 按档案；P5 前为 16 |
| 视频 · 文生视频 `text` | 无媒体输入（文本节点出现后增加 `prompt` 口） | — | — |
| 视频 · 首尾帧 `frames` | `first_frame`、`last_frame` | image | 各 1 |
| 视频 · 参考生视频 `reference` | `reference` | image、video、audio | 按档案；P5 前为 16 |

- 视频方式 id 与现有视频档案的模式 id（`text`／`frames`／`reference`）一致。生成时，连线映射为 `GenerationInput`：`role` 取目标端口 id（`reference`／`first_frame`／`last_frame`），`kind` 取源节点输出的数据类型，`sha256` 取源节点当前版本。图片节点有参考时按参考图模式生成，否则按文生图。
- 校验分三层：
  1. **数据类型**（连线时阻止）：源输出类型必须在目标端口的 `accepts` 中。逻辑集中在 `<ReactFlow isValidConnection>`；拖线过程中不兼容的端口变灰，松手后给出中文原因。
  2. **结构规则**（连线时阻止）：禁止自连、重复边和成环（沿 source→target 检测），端口条数不得超过 `max`，分组节点不参与连线，空节点（没有版本）可以连线。
  3. **模型能力**（允许连线，生成前拦截）：数量上限、参考视频和音频需要对象存储、首尾帧与全模态参考互斥等，复用 `checkGenerationRequest`，在节点上提示。连线后用户仍可能换模型或模式，因此不在连线时拦截。
- **切换视频生成方式**：自动删除不再兼容的连线，切换与删除合并为一步撤销，并提示断开了几条。P5 接入模型后，方式切换按档案收窄（只有首帧的档案禁用尾帧端口，不支持的方式隐藏）。
- **交互**：拖线到空白处松手，在落点弹出按兼容类型过滤的添加菜单，选中后自动连线；拖动已有连线的端点可重连；选中连线按 Delete 删除。节点的参考栏显示输入并可拖动调整 `inputOrder`。
- 端口和连线按数据类型着色，同时配图标，不只靠颜色区分。

### 工具、操作栏与快捷键

- **底部操作栏**（居中浮动，从左到右）：添加节点 N（主按钮，菜单由注册表生成，不显示未实现类型）｜指针 V｜框选 B｜抓手 H ‖ 撤销｜重做 ‖ 快捷键帮助 ?。
- **右上角工具组**：缩放比例（下拉：适应视图、100%、各档位）｜按类型整理｜按布局整理（下拉：宫格、水平、垂直）｜连线显示（下拉：全部、仅选中相关、隐藏）｜小地图开关；工具组下方是 180×120 小地图。
- **工具定义**：

  | 工具 | 左键拖空白 | 拖节点 | xyflow 配置 |
  | --- | --- | --- | --- |
  | 指针（默认） | 平移 | 移动 | `panOnDrag` |
  | 框选 | 框选（部分相交即选中） | 移动 | `selectionOnDrag`、`panOnDrag={[1]}`、`selectionMode="partial"` |
  | 抓手 | 平移 | 不可拖、不可选 | `nodesDraggable={false}`、`elementsSelectable={false}` |

  任何工具下按住空格临时切到抓手，中键拖动始终平移；光标在默认、grab、grabbing 之间切换。
- **快捷键**：
  - 视图：滚轮以光标为中心缩放（10%–400%，`zoomOnDoubleClick` 关闭），Ctrl+= ／ Ctrl+- 缩放，Shift+1 适应视图，Shift+0 回到 100%，M 开关小地图。
  - 选择：Ctrl+A 全选，Shift／Ctrl+点击加选，Esc 取消选择或关闭菜单。
  - 编辑：Delete／Backspace 删除，Ctrl+C／X／V 复制剪切粘贴，Ctrl+D 原地复制，F2 重命名，Ctrl+Z 撤销，Ctrl+Shift+Z 或 Ctrl+Y 重做，Ctrl+G 分组，Ctrl+Shift+G 解组，方向键微移 1px（加 Shift 为 10px）。
  - 双击空白处在落点打开添加菜单。
- **快捷键层**由画布自管（`deleteKeyCode={null}`），只在画布获得焦点时生效：焦点位于 input、textarea、select、contentEditable 内时不处理；`event.isComposing` 或 `keyCode === 229` 时一律放行，避免输入法组字时的空格、Backspace 误触。节点内可交互区域加 `nodrag`、`nowheel`、`nopan`。
- **剪贴板**：监听 document 的 `copy`、`cut`、`paste`。写入自定义类型 `application/x-frame-loom-canvas` 和带 `frame-loom-canvas/v1:` 前缀的纯文本回退；只复制选中节点及其内部连线，粘贴时重新生成 id，位置跟随鼠标，连续粘贴依次偏移。粘贴内容不可信，经 zod 严格校验并限制为 4 MiB。粘贴外部图片或视频文件时先上传再建节点。
- **拖入文件**：资源管理器拖入的 `File` 直接以流上传 `POST /media`，不需要本机路径，preload 不变。上传中显示占位节点和进度，失败可重试或删除；上传状态不进文档。

### 分组、整理、连线显示、小地图

- **分组**：`group` 节点类型，基于 `parentId`，首期只支持一层。支持标题、颜色（8 个 token 色，明暗成对）、`NodeResizer`、适应内容、解组。拖动节点松手时用 `getIntersectingNodes` 判断是否入组，拖出组框即脱离；绝对坐标与相对坐标的换算集中在命令层。
- **整理**作用于选区，没有选区时作用于全部；有分组时在组内整理并收紧组框：
  - 按布局：宫格（列数默认 ⌈√n⌉）、水平、垂直；
  - 按类型：按节点类型分桶，每桶一行；
  - 排序按标题（`Intl.Collator` 数字感知）或创建顺序，间距 40px；锚点保持在原包围盒左上角；整个整理计为一步撤销。
  - 布局全部是纯函数；对齐线、对齐均分、按依赖分层留到后续。
- **连线显示**：全部／仅选中相关／隐藏。隐藏只影响渲染，不删除参考关系；拖线和悬停时临时显示，节点角标显示参考数量。
- **小地图**：右上角，xyflow `MiniMap`，可拖动、可缩放、点击定位，节点按类型 token 着色；画布宽度低于阈值时自动收起。节点达到上千时再评估换成 Canvas 绘制。

### 主题与视觉

- 只导入 `@xyflow/react/dist/base.css`，在 `packages/canvas/src/styles.css` 中把 `--xy-*` 映射到语义 token：连线 `border-strong`、选中 `brand`、节点底 `card`、选区 `brand` 加透明度、小地图底 `popover`。不使用 `colorMode` 与 `.dark` 类，跟随现有 `prefers-color-scheme`。
- 画布页铺满主区且不滚动：路由切到画布时，外壳去掉 `<main>` 的 `canvas-grid` 与 `overflow-y-auto`；背景用 xyflow `<Background variant="dots" gap={24}>`，点色取 `--dot`，点阵随平移缩放移动。
- `theme.css` 新增并明暗成对定义：4 个端口数据类型色、8 个分组色、连线警告色、小地图遮罩，以及参考稿中的浮动栏、右上工具组、节点卡片三组阴影。暗色值按现有暗色 token 推算，实现后需目检确认。
- 视觉参照 `docs/design/canvas-ui-light.html`：浮动栏 12px 圆角、6px 内边距，按钮 36×36、8px 圆角、18px 图标，分隔线 1×20；右上工具组 8px 圆角、4px 内边距、12px 文字与 16px 图标；节点卡片 1px 描边、8px 圆角；主按钮用 `primary`，当前工具用 `accent-active`；空画布居中提示「双击画布　自由生成节点」和「按住 Space 拖拽画布，滚轮缩放画布」（键帽样式），有节点后隐藏。主色、底色、点色与间距一律使用项目 token（`brand`、`canvas`、`dot`、24px 点阵），不照搬参考稿色值。
- 所有按钮使用 `@frame-loom/ui` 的 Button，提供中文可访问名称，Tooltip 写明快捷键；xyflow 的读屏文案经 `ariaLabelConfig` 改成中文。

### 持久化

- engine 新增 `modules/canvas` 与 `canvas_documents` 表：`id, title, schema_version, revision, document_json, view_json, created_at, updated_at`，由 Drizzle 生成迁移。
- 接口：
  - `GET /canvases/:id`：不存在时返回 JSON `null`。
  - `PUT /canvases/:id`，请求体 `{ revision, document }`：revision 为 0 时创建；与库内不一致时返回 409 `CANVAS_REVISION_CONFLICT`；成功返回新 revision。engine 用 contracts 校验外层结构、上限，并按注册的内置类型校验 image、video、group 的 `data`；未知类型的 `data` 原样保存。
  - `PUT /canvases/:id/view`：保存视图状态，不改 revision，后写覆盖。
- id 为 `^[a-z0-9-]{1,64}$`，画布测试页固定使用 `lab`；项目管理落地后增加 `project_id` 关联。
- renderer 修改后防抖 1 秒自动保存，切换路由和关闭窗口前立即保存，标题区显示「已保存／保存中／保存失败」。409 时提示其他窗口已修改，提供「重新加载」与「导出当前画布 JSON」，never 静默覆盖。
- 修改统一走命名命令，以后 Agent 写画布可以映射为带前值的命令与回执，不改文档模型。

### 撤销重做

- 历史保存整份文档快照（不可变更新天然共享未改动的节点），上限 100 步。拖拽、缩放尺寸、批量整理各合并为一步；选择、视口、视图状态、尺寸测量不进历史。
- 生成任务回写（P5）作为系统事务直接写入当前文档和所有历史快照中的同一节点，不形成撤销步骤；手动切换版本计入撤销。
- 外部重新加载文档（409 后）清空历史。

### engine 退出与应用菜单（P0）

- 主进程不再在 engine 退出时重载页面，改为向可信窗口发送 `engine:exited { code }`；preload 暴露 `onEngineExited(callback)` 并返回取消订阅函数，renderer 只经 `lib/desktop-bridge.ts` 订阅。外壳收到事件后使健康查询失效并显示错误圆点；engine client 后续请求得到中文错误。画布保留内存中的文档，保存状态显示失败，可导出 JSON。
- 移除默认应用菜单，生产包不再响应 Ctrl+R、开发者工具和页面缩放快捷键；开发模式保留开发者工具。页面级缩放（Ctrl+滚轮、触控板捏合）在主进程锁定，具体手段实测后写回本篇。

### 节点内生成（P5）

- 图片和视频节点内置生成区：提示词、模型（按类别筛选已启用模型）、视频生成方式、档案参数；提交 `POST /generation-jobs`，`source: 'canvas'`，`inputs` 由连线按上文映射，`modelId` 与参数保存在节点 `data`。
- 提交后节点写入 `pendingJobId`；SSE `generation.job.updated` 与活动任务定时查询驱动刷新。任务成功后把产物追加为新版本并设为当前版本，清除 `pendingJobId`。画布未打开时完成的任务，在下次打开时根据 `pendingJobId` 查询并补写。
- 删除生成中的节点时提示「远端可能仍在运行并计费」，提供同时放弃任务的选项，复用现有 cancel。
- P5 验收通过后，按[模型管理](../architecture/2026-10-24-model-management.md)约定删除模型测试页的路由、feature 与侧栏入口，engine 接口保留。

### 视频与图片性能

- 视频节点默认只显示封面图；悬停或选中时才挂载 `<video preload="metadata" muted>`，同一时刻只播放一个。封面由前端抽取：seek 到首帧，绘制到 canvas，toBlob 后上传 `/media`，sha256 存入 `posterSha256`。
- 图片使用 `decoding="async"`、`loading="lazy"`。节点数超过 50 时开启 `onlyRenderVisibleElements`；节点内一切持久状态放在 store，组件卸载不得丢失数据。
- 缩略图服务暂不实现：大量 4K 原图同时解码会占内存，作为 `shortcut:` 注明，实测出现内存压力时再由 engine 生成缩略图。

### 其他交互

- 右键菜单（节点、连线、画布）、锁定节点、置顶与置底、重命名、导出与导入 JSON。
- 窄窗口：画布宽度不足时底部操作栏收起次要按钮、小地图自动收起；画布页可以折叠侧栏。
- 删除节点不删除 media 文件，孤儿媒体清理留给项目管理阶段。

### 实施阶段

| 阶段 | 内容 |
| --- | --- |
| P0 预备 | engine 退出改类型化事件；移除默认菜单并锁定页面缩放；抽出 `packages/ui` |
| P1 骨架 | 画布包、xyflow、token 映射、`/canvas-lab` 路由与侧栏「画布测试」、背景、缩放、小地图、底部操作栏与右上工具组、工具状态机、快捷键层 |
| P2 节点与连线 | 注册表；图片、视频节点（上传、拖入、粘贴、封面、三种视频方式）；三层校验中的前两层；连线显示；删除；复制粘贴；撤销重做 |
| P3 组织 | 分组与解组、入组出组、四种整理、右键菜单、锁定与层级、导出导入 |
| P4 持久化 | engine `modules/canvas`、迁移、409、自动保存、视图状态 |
| P5 节点内生成 | 生成区、连线映射、版本写回、补写、删除时的任务处理、第三层校验；删除模型测试页 |

### 相关笔记核对

- [桌面壳](../../implemented/architecture/2026-10-24-desktop-shell.md)、[应用骨架](../../implemented/architecture/2026-10-24-desktop-stack-and-process-model.md)：部分重叠。engine 退出的重载捷径由本篇 P0 替换为类型化事件，preload 增加一个订阅方法；进程模型与鉴权边界不变。P0 落地时原地同步两篇的退出行为与 preload 方法列表。
- [engine 与 renderer 基础设施](../../implemented/architecture/2026-10-24-engine-and-renderer-foundation.md)：部分重叠。该篇的"renderer 不拆 `packages/ui`"理由是没有第二个使用者，画布包成为第二个使用者；"Zustand、`@xyflow/react` 到首个需要它的功能再引入"由本篇兑现。落地时原地同步目录与延后项事实，不改写其决定。
- [主题与外壳](../../implemented/feature/2026-10-24-theme-and-app-shell.md)：部分重叠。新增画布 token、侧栏「画布测试」、默认菜单移除；同步该篇对默认菜单快捷键的后果描述。
- [lint 与格式化](../../implemented/process/2026-10-24-lint-and-format.md)：部分重叠。renderer 规则扩展到两个新包并增加包级导入边界，落地时原地同步。
- [模型管理](../architecture/2026-10-24-model-management.md)：部分重叠。复用 `/media`、`frame-media://`、生成任务与档案；模型测试页的删除条件由本篇 P5 触发。
- [共享契约](../../implemented/architecture/2026-10-24-shared-contracts.md)：部分重叠，新增 `canvas.ts` 与 `engine:exited` 事件载荷，契约约定不变。
- [Agent 内核选型](../architecture/2026-10-24-agent-runtime-pi.md)：相关但不重叠；本篇只保证画布修改走命名命令，Agent 工具另行设计。
- 其余流程类笔记无关。

## Alternatives considered

- **tldraw 5.5.2** — 最强理由：画布能力最完整，撤销重做、剪贴板、吸附、culling 内置，官方 image-pipeline 模板已有带类型端口与环检测。不选：生产环境必须购买 license key，否则停止渲染；自有 shape 体系与 shadcn／Tailwind 组件的融合成本高，包体约 15 MB。
- **自写视口（basketikun/infinite-canvas 的做法）** — 最强理由：零图库依赖，渲染与交互完全可控，参考项目已证明能做出完整的 AI 画布。不选：平移缩放、框选、连线命中、小地图、子流和读屏都要重写，xyflow 以 MIT 提供这些且有 Dify、Langflow、MiniMax 等大规模使用。
- **Konva／Leafer／Fabric 等 2D canvas 渲染器** — 最强理由：大量节点时渲染性能最好。不选：节点内的表单、视频和 shadcn 组件需要另做 DOM 叠层，端口、连线、小地图、撤销全部自写，首期工作量最大。
- **Excalidraw** — 最强理由：MIT、生态大、可直接嵌入。不选：不支持自定义元素类型，没有端口与连线类型校验。
- **fork xyflow（MiniMax 的做法）** — 最强理由：可以加原版没有的拖拽吸附钩子等能力。不选：升级与合并成本高；对齐线可以用 `onNodeDrag` 自行计算。
- **画布直接写在 `apps/desktop/.../features/canvas`** — 最强理由：不新增包，沿用现有 tsconfig、ESLint 与 Vitest 配置。不选：用户要求画布功能与界面在独立 package 中实现，以便项目管理复用；feature 不能互相导入，项目管理页面无法直接使用 feature 内的画布。
- **画布包内自带 shadcn 组件（不抽 `packages/ui`）** — 最强理由：改动小，不触碰 desktop 现有约 20 处导入。不选：同一套组件出现两份，主题修正要改两处；项目管理也会需要这些组件。
- **视频节点按角色画出全部端口，或连线上记录角色** — 最强理由：一个节点能同时表达首尾帧和参考，换方式无需断线。不选：用户确定视频节点按三种生成方式区分，端口由方式决定，连线不带角色；这与档案中首尾帧和全模态参考互斥的约束一致。
- **切换视频方式时保留不兼容连线并标为失效** — 最强理由：切回原方式时连线自动恢复。不选：xyflow 找不到对应端口的连线会报错，需要额外渲染隐藏端口；用户采纳自动断开加一步撤销。
- **每次生成新建一个节点** — 最强理由：所有结果平铺可见，便于对比。不选：用户确定写回本节点作为新版本，节点即生成位，下游连线始终引用当前版本而不必改线。
- **zundo 中间件做撤销** — 最强理由：Dify 已验证，接入 zustand 只需几行。不选：仍需自定义合并拖拽、排除视图状态和系统事务回写，整份快照栈自写约百行即可覆盖，不增加依赖。
- **视图状态存 localStorage（MiniMax 的做法）** — 最强理由：不需要后端接口，读写同步。不选：开发与生产的源不同，localStorage 是两份，[主题与外壳](../../implemented/feature/2026-10-24-theme-and-app-shell.md)已因同一原因放弃 localStorage；与文档同行保存还能随项目迁移。
- **首期引入 dagre 做整理** — 最强理由：有连线的部分按依赖从左到右排更直观，MiniMax 已采用。不选：首期要求的按类型、宫格、水平、垂直用包围盒计算即可；按依赖分层另行评估。elkjs 为 EPL-2.0／GPL-3.0 双许可，不考虑。
- **小地图首期用 Canvas 自绘（MiniMax 的做法）** — 最强理由：上万节点时仍流畅。不选：首期上限 2000 节点，xyflow 自带的 SVG `MiniMap` 已支持拖动、缩放和按类型着色；实测卡顿时再换。

## Acceptance criteria

自动测试，进入 `pnpm test` 与 CI：

1. contracts：`CanvasDocument`、`CanvasView` 合法与非法输入，上限与父子顺序校验。
2. 画布包单测：
   - 注册表与校验：数据类型不兼容、自连、重复、成环、端口条数上限、分组不可连线；视频三种方式的端口与切换方式时断开的连线数。
   - 命令与历史：增删、连线、粘贴（id 重写、内部连线保留、外部连线丢弃）、分组解组的坐标换算、拖拽合并为一步、系统事务不入历史、上限 100 步。
   - 布局纯函数：宫格、水平、垂直、按类型，锚点不变、组内整理收紧组框。
   - 快捷键判定：可编辑元素内不触发、`isComposing` 与 229 放行、空格临时抓手。
   - 剪贴板：前缀与 MIME 往返、非法与超限内容被拒绝。
3. engine 集成（真实 SQLite）：创建、读取、revision 递增、409 冲突、上限与内置类型 `data` 校验、视图保存不改 revision。
4. desktop：`engine:exited` 事件只发往可信窗口、preload 剥离原始事件并可取消订阅；engine 退出后页面不重载、画布内容保留。
5. 桌面 e2e：打开「画布测试」，上传图片建节点，图片连到视频「首尾帧」的首帧口成功、连到「文生视频」被拒绝；切换方式断开连线并可撤销；保存后重启应用内容与视口保留。P5 另覆盖模拟供应商下的图片生成与图片作首帧生成视频，并写回为新版本。

人工验收（开发环境与加固 exe，明暗两种模式）：

1. 底部操作栏、右上工具组、小地图和空画布提示符合参考稿风格，颜色全部跟随主题。
2. 空格平移、滚轮缩放、三种工具、全部快捷键可用；中文输入法在节点输入框内组字不会误删节点或平移。
3. 复制粘贴跨画布刷新后仍可粘贴；粘贴系统剪贴板图片和拖入资源管理器文件都能建节点。
4. 分组、入组出组、四种整理、连线三档显示、小地图定位正常。
5. 500 个节点（其中 50 个视频）时平移缩放无明显卡顿，内存无持续上涨。
6. 720×560 最小窗口下操作栏与小地图不遮挡、不溢出；键盘焦点可见。
7. 结束 engine 进程后页面不重载、提示错误，画布可导出 JSON。

## Risks

- **xyflow 行为细节**：空格平移在 textarea 中的表现、触控板捏合以 Ctrl+wheel 到达、`onlyRenderVisibleElements` 卸载节点、父节点排序要求，都需要 P1／P2 实测；不符合时调整配置或在快捷键层处理，必要时记入本篇。
- **页面缩放锁定**：Electron 对 Ctrl+滚轮与捏合缩放的拦截手段需要实测，若只能部分锁定，需在画布内吞掉对应事件并记录残余行为。
- **抽取 `packages/ui`**：纯迁移会改动 desktop 约 20 处导入、ESLint 与 Tailwind 的扫描路径以及 shadcn CLI 配置；漏扫类名会导致生产样式缺失，需构建后对比页面。
- **视频资源**：大量视频节点受 Chromium 媒体播放器上限和解码内存约束；按需挂载失效时会黑屏或崩溃，验收第 5 项兜底。
- **文档体积**：首期整份文档保存，节点多时每次保存都传输完整 JSON；超过上限或保存耗时明显时，再改为命令增量写入。
- **版本写回与撤销交织**：系统事务改写历史快照，若遗漏会导致撤销后结果"消失"，需要单测覆盖。
- **暗色阴影与新增 token 值**为推算值，需设计确认。
- **回滚**：各阶段分开提交，可单独 revert；`canvas_documents` 迁移一旦分发不重写，回退时新增反向迁移。
