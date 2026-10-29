# Agent Note: 剧本编辑器内核选用 Tiptap

Status: proposed

## Problem

[剧集与结构化剧本](../feature/2026-10-29-episodes-and-structured-scripts.md)要求编辑器内的文档就是标准剧本格式：一个扁平的带类型段落列表，每个段落有稳定 id，并且要支持编剧软件式的键盘规则、段落手柄拖动、存疑标记、元素下划线高亮、人物自动补全和撤销重做。仓库目前没有任何富文本编辑器依赖。手写 `contenteditable` 要自己处理输入法组字、选区、撤销和粘贴，风险过高。

约束：

- renderer 是 React 19.3 加 Vite 8。生产 CSP 不允许 `unsafe-eval`，也不允许远程资源。
- 一集剧本最多 5000 个段落。
- 依赖要精确锁定版本，许可证必须允许商业分发。
- 文档里只存纯文本段落，不存行内标记。高亮来自实时匹配（见上面的功能笔记）。

## Proposal

### 依赖

依赖加入 `apps/desktop` 的 `devDependencies`。与仓库现有做法一致，renderer 依赖全部放在 `devDependencies`，由 electron-vite 打包。版本精确锁定为 `3.32.1`，`@tiptap/*` 各包必须保持同一版本：

- `@tiptap/core`、`@tiptap/pm`、`@tiptap/react`：编辑器核心、ProseMirror 和 React 绑定，均为 MIT 许可。
- `@tiptap/extension-document`、`@tiptap/extension-text`：根节点和文本节点。
- `@tiptap/extensions`：只使用其中的 `UndoRedo` 和 `Placeholder`。
- `@tiptap/extension-unique-id`：为段落维护 `id` 属性。拆分、粘贴、撤销重做之后 id 仍保持唯一。这个扩展 2025 年已改为 MIT 开源。

不安装 `@tiptap/starter-kit`，以免引入标题、列表、粗体这类剧本用不到的节点。也不安装 `@tiptap/extension-drag-handle-react`：它的 peer 依赖包含 `@tiptap/extension-collaboration`、`@tiptap/y-tiptap` 和 `yjs`，为了一个拖动手柄引入整套协同依赖不划算。

### 文档模型

- 只有一种 block 节点 `scriptBlock`，`content: 'text*'`，不允许任何 mark，`code: false`。属性包括：
  - `id`：由 UniqueID 维护；
  - `type`：`BlockType`；
  - `attrs`：JSON 字符串，只有 scene 和 character 类型使用；
  - `src`：原文行号或 `null`；
  - `review`：JSON 字符串或 `null`。

  `doc` 的 content 为 `scriptBlock+`。HTML 渲染为 `<p data-block-type data-id>`，各类型的样式只通过 `data-block-type` 选择器加 token 实现。
- `toEditorJson(document)` 和 `fromEditorJson(json)` 放在 `features/projects/script/editor-model.ts`，两者必须无损互逆。`fromEditorJson` 的输出要经过 `ScriptDocument.parse` 校验，校验失败时不保存，并显示错误。
- 编辑某个段落的文字时，清除该段的 `review`。这在 `appendTransaction` 中实现：凡是文本发生变化的段落，如果带有 `review`，就清除。

### 交互的实现方式

- **键盘规则**：在 `scriptBlock` 扩展的 `addKeyboardShortcuts` 中实现。每条规则对应 `script-commands.ts` 中的一个纯函数命令，单测可以直接在 `EditorState` 上调用这些命令，不需要 DOM。
- **元素高亮和存疑竖条**：用一个 ProseMirror 插件的 `DecorationSet` 实现。初始化时全量计算；之后只对 transaction 改动过的段落调用 `findMentions` 重新计算，其余部分用 `mapping` 映射。设定库变化时，通过 `setMeta('mentions', terms)` 触发一次全量重算。装饰不进入文档，也不进入撤销历史。
- **段落手柄**：在编辑器容器内放一个自绘的浮动按钮。鼠标移动时，用 `view.posAtCoords` 找到当前段落，把按钮定位到该段左侧。点击按钮打开类型菜单；按住拖动时，设置 `NodeSelection`，并把 `view.dragging = { slice, move: true }` 交给 ProseMirror 的原生拖放处理。键盘用户用 Alt+↑ 和 Alt+↓ 代替拖动。
- **自动补全和浮动工具条**：用 React 组件加 shadcn Popover 实现，锚点取自 `view.coordsAtPos`。只读取 editor 的状态，通过命令修改文档。
- **大纲拖动整场**：计算出该场的段落区间后，用一个 transaction 完成「删除区间、在目标位置插入」，这样一次撤销就能恢复。
- **从外部跳转到某段**：通过 `data-id` 查找 DOM 节点，调用 `scrollIntoView`，再加上一次性的高亮装饰。

### 边界

- `@tiptap/*` 只能在 `apps/desktop/src/renderer/src/features/projects/script/` 中 import。其他代码只依赖 `ScriptDocument`。以后更换编辑器内核时，改动限于这个目录。
- 升级 Tiptap 要单独提交，并且必须重跑 `script/` 目录的单测和剧本页 e2e。

## Alternatives considered

- **Lexical**：最强的理由是 Meta 维护、性能好、React 集成自然，自定义节点的能力也够用。没有采用：段落 id 要自己在节点 key 之外另行维护，粘贴和拆分时的 id 去重也要自己写；Tiptap 的 UniqueID、ProseMirror 的装饰和 `mapping` 正好覆盖这份需求中最难的两点（稳定 id、增量高亮）。
- **直接使用 ProseMirror**：最强的理由是少一层封装，没有 Tiptap 的版本耦合。没有采用：React 绑定、扩展组织、快捷键、Placeholder 和 UniqueID 都要自己写；Tiptap 本身就是 ProseMirror 的薄封装，需要时仍可直接访问 `view` 和插件 API。
- **CodeMirror 6，每行就是一个段落**：最强的理由是剧本天然按行组织，CodeMirror 处理大文档性能最好，行装饰也很方便。没有采用：在 CodeMirror 中维护每一行的稳定 id 和类型，只能靠自己编写 StateField 并跟随 changes 做映射，粘贴和拆分时的 id 规则也要自己实现；它也不适合把段落渲染成不同排版的块（居中、缩进、徽标）。
- **使用官方 DragHandle 扩展**：最强的理由是拖动手柄现成可用，键盘和定位都已处理好。没有采用：它要求安装协同相关的 peer 依赖（`@tiptap/extension-collaboration`、`@tiptap/y-tiptap`、`yjs`），而自绘手柄加原生拖放的代码量不大。

## Acceptance criteria

1. `pnpm --filter @frame-loom/desktop typecheck` 通过；`pnpm install --frozen-lockfile` 在干净环境中可以复现；`@tiptap/*` 的 import 只出现在 `features/projects/script/`。可以用 `rg "@tiptap/" apps/desktop/src --files-with-matches` 检查。
2. 往返转换的单测通过：样例剧本的 60 个段落，以及包含每种段落类型、attrs、review、空文本的人工用例，都满足 `fromEditorJson(toEditorJson(doc))` 等于 `doc`。
3. 拆分段落和粘贴多行之后，所有 id 仍然唯一；撤销之后 id 恢复为原值。
4. 在构建产物 e2e 中（`app://` 协议加 `PRODUCTION_CSP`）验证以下几点，控制台都不能有 CSP 错误：可以正常输入；先用 CDP `Input.imeSetComposition` 组字、再用 `Input.insertText` 提交后，文字写入当前段落，段落数不变；段落可以拖动。在组字过程中按 Enter 不应拆分段落，这一点在开发模式下用真实的中文输入法人工检查一次，并记入实施计划。
5. 记录性能数据：3000 段剧本的首屏加载时间，以及连续输入 50 个字符时每次按键的平均耗时。数字写进实施计划。如果明显卡顿（每次按键超过 16ms），先优化装饰计算，再考虑其他方案。

## Risks

- **包体积**：ProseMirror 加 Tiptap 约 150–250 KB（gzip 前）。剧本页采用路由级懒加载，不影响首屏。
- **输入法组字**：ProseMirror 对 IME 的处理成熟，但自定义键盘规则在组字期间不能触发。所有快捷键处理都要先检查 `view.composing`。
- **版本耦合**：`@tiptap/*` 各包必须保持同一版本，升级时一起修改。
- **大文档**：每次按键时，装饰只重算改动过的段落；全量重算只在加载时和设定库变化时发生。
