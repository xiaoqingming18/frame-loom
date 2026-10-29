# Plan: 编辑器内核与保存

Status: active
Parent: plan.md
Note: ../../notes/proposed/architecture/2026-10-29-script-editor-tiptap.md

## 目标

剧本页内置一个 Tiptap 编辑器，完成后应满足以下几点：

- 文档与 `ScriptDocument` 之间可以无损往返；
- 功能笔记中「键盘规则」一节的每一条都已实现，并且有单测；
- 每种段落类型的排版都按笔记实现；
- 工具栏提供段落类型下拉框、撤销、重做和快捷键帮助；
- 停止输入 1 秒后自动保存；离开路由或关闭窗口前，先等待保存完成；
- 遇到 409 时，提供「重新加载」和「复制全文」；
- 粘贴多行纯文本时，按行拆成多个段落；
- 从空白开始写时，第一段是场标题。

本子计划不包含大纲、段落手柄、存疑标记、高亮、元素栏（这些在 07），也不包含导入（08）。

## 前置条件

- 05 已完成，剧本页路由外壳可用。
- 已阅读编辑器笔记全文。
- 已阅读功能笔记的「剧本文件」规则，以及「剧本页」中的编辑器、工具栏、键盘规则、粘贴、自动保存几部分。
- 已阅读 `features/projects/canvas/canvas-persistence.ts` 和 `project-canvas.tsx` 中保存、离开拦截和 `beforeunload` 的写法。

## 步骤

- [ ] T1 在 `apps/desktop` 的 `devDependencies` 中精确安装以下包，版本都是 `3.32.1`：`@tiptap/core`、`@tiptap/pm`、`@tiptap/react`、`@tiptap/extension-document`、`@tiptap/extension-text`、`@tiptap/extensions`、`@tiptap/extension-unique-id`。同时提交 `pnpm-lock.yaml`。

  — 验证：
  - `pnpm install --frozen-lockfile` 通过；
  - `rg "@tiptap/" apps/desktop/src --files-with-matches` 的结果只在 `features/projects/script/` 下；
  - lockfile 中 `@tiptap/*` 的所有包只有一个版本。
- [ ] T2 新建 `script/editor-model.ts`，定义 `scriptBlock` 节点和根 doc 的 schema，以及 `toEditorJson` 和 `fromEditorJson` 两个函数。字段与渲染规则见编辑器笔记「文档模型」一节。

  — 验证：`editor-model.test.ts` 覆盖以下几点：
  - 样例剧本的规则解析结果，以及一份覆盖全部 11 种段落类型的人工文档（包含 attrs、review、src 为 null、空文本），往返之后 `toEqual` 原文档；
  - `fromEditorJson` 拒绝含换行的文本；
  - 以上测试都在 node 环境下用 `EditorState` 完成，不挂载 DOM。
- [ ] T3 新建 `script/script-commands.ts`，把功能笔记「键盘规则」一节的每一条实现成纯函数命令。命令包括：
  - Enter：在段落中间时拆分；在段落末尾时，按类型映射新建下一段；在非 action 的空段落中，改为 action；
  - Tab 和 Shift+Tab：在空段落中循环切换类型；
  - Ctrl+1～9：直接设置类型；
  - action 段落按 Enter 时识别场标题，character 段落按 Enter 时解析 delivery 后缀；
  - Alt+↑ 和 Alt+↓：上下移动当前段落；
  - 所有快捷键在 `view.composing` 为 true 时都不处理。

  在 `appendTransaction` 中实现：凡是文本发生变化的段落，清除 `review`。

  — 验证：`script-commands.test.ts` 用表驱动的方式，对每条规则分别构造前置 `EditorState`、执行命令、断言结果段落。必须覆盖以下几点：
  - Enter 的 11 种类型映射逐一断言；
  - Tab 循环一整圈后回到 action；
  - 输入「1-8 夜 外 天台」后按 Enter，得到 scene 段落，`time` 为 night、`space` 为 ext、文本为「天台」；
  - 「店主（OS）」按 Enter 后，文本为「店主」、delivery 为 os；
  - 拆分段落后，所有 id 唯一；撤销后恢复为原来的 id；
  - 修改带 `review` 段落的文字后，`review` 被清除。
- [ ] T4 新建 `script/script-editor.tsx` 和 `script/script-editor.css`：
  - 纸面最大宽度 760px，各段落类型的排版按笔记实现，样式只使用 `data-block-type` 选择器和语义 token；
  - 场标题中的时间 chip 和内外 chip 可以点击循环切换，调用命令修改 attrs；
  - 角色名使用 `--tag-pink`；
  - 粘贴多行纯文本时，按行拆成多个段落；当前段是 scene 时，拆出的段落为 action；
  - 文本为空时显示 Placeholder：场标题为「1-1 日 内 地点」，其他类型显示该类型的中文名。

  — 验证：
  - 组件测试（jsdom）挂载编辑器，断言 `data-block-type` 渲染正确，点击场标题的时间 chip 后 `time` 发生变化；
  - 用 `ClipboardEvent` 模拟粘贴三行纯文本，得到 3 个段落；
  - 不写样式类名的测试。
- [ ] T5 工具栏和快捷键帮助：
  - 工具栏吸顶，包含段落类型下拉框（显示光标所在段落的类型，可以切换）、撤销、重做、快捷键帮助「?」，以及保存状态（`role="status"`，`aria-label="剧本保存状态"`）；
  - 快捷键帮助弹窗使用 Dialog，列出全部键盘规则；
  - 「重新导入」和「查看原文」按钮先放在工具栏中，设为禁用，由 08 接上。

  — 验证：组件测试覆盖：切换下拉框后，当前段落的类型改变；撤销和重做按钮的禁用状态随历史变化。
- [ ] T6 新建 `script/script-persistence.ts`，参照 `canvas-persistence.ts`：
  - 持有 revision；停止输入 1 秒后保存；保存的 `PUT` 响应中如果 `addedElements` 大于 0，就使 `storyQuery` 和 `episodesQuery` 失效；
  - 遇到 409 `SCRIPT_REVISION_CONFLICT` 时，进入冲突状态，停止保存，显示「重新加载」和「复制全文」（按段落文本用换行拼接后写入剪贴板）；
  - 遇到 409 `SCRIPT_CONVERTING` 时，显示「正在转换，暂不能保存」；
  - 离开路由时，用 `useBlocker` 等待保存完成；关闭窗口时，在 `beforeunload` 中等待保存，与画布宿主相同。

  `script-page.tsx`：
  - 剧本没有段落，也没有 `pendingImport` 时，显示两张卡片：「粘贴整集剧本」（本子计划中暂时禁用，由 08 接上）和「从空白开始写」（插入一个空的 scene 段落并聚焦）；
  - 有段落时显示编辑器。
  - 剧本页使用路由级懒加载，确保 Tiptap 只打进剧本页的 chunk。

  — 验证：`script-persistence.test.ts` 使用 fake timers 覆盖以下几点：
  - 连续输入只触发一次保存；
  - 保存过程中又有输入，会在完成后再保存一次；
  - 409 冲突后不再自动保存，重新加载后恢复；
  - `flush` 返回值反映保存是否成功。

  构建后，检查 `apps/desktop/out/renderer` 中 Tiptap 只出现在剧本页的 chunk 里，不在入口 chunk 中。

## 验证

- 预期：
  - `pnpm --filter @frame-loom/desktop typecheck` 通过；
  - `pnpm --filter @frame-loom/desktop exec vitest run --project renderer src/renderer/src/features/projects/script` 通过；
  - 对改动的文件运行 `pnpm exec eslint` 通过；
  - 在开发模式下手工检查一次：用中文输入法输入「你好」时，在组字过程中按 Enter 不会拆分段落。把结果记入「发现与偏差」。

  本子计划不运行 e2e。
- 实际：`pnpm --filter @frame-loom/desktop typecheck`、定向 vitest（4 文件 47 测试）、定向 eslint、desktop build 均通过。安装时 frozen lockfile 校验通过；Tiptap 仅进入剧本路由 chunk（740.13 kB），入口不含编辑器实现。真实中文输入法检查待整体验收补齐。

## 进度

- 2026-10-29：创建子计划草稿。

## 发现与偏差

- 撤销恢复 review 时跳过文本变化清理插件，避免把历史恢复误当作手工输入；已用回归测试验证。
- 真实中文输入法人工检查尚未执行，因此本子计划暂保持 active；代码工作可供后续面板集成。

## 交接

编辑器代码、47 项测试已完成；下一步集成 07，收尾时补真实中文输入法检查。
