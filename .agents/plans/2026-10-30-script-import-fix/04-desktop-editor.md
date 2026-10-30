# Plan: 编辑器修正

Status: done
Parent: plan.md
Note: ../../notes/implemented/architecture/2026-10-29-script-editor-tiptap.md

## 目标

`apps/desktop/src/renderer/src/features/projects/script/` 完成笔记中以下几节的界面改动：「幕」「段落类型切换」「排版补充」「转换结果提示」「元素高亮」。具体包括：

- 编辑器模型支持 v2 文档、production 类型、新的 attrs，以及前言和附录；
- 类型菜单、下拉框和 Tab 循环中去掉「幕」，在大纲中插入和移除分幕；
- 所有类型切换的入口都改为调用 `retypeBlock`；
- 场标题、角色、sound、production 的新排版；
- 前言和附录的折叠卡片；
- 「元素标记」开关，以及 `scriptMentions` 偏好；
- 转换结果的提示文案。

本子计划不涉及 Markdown 视图（05）。

## 前置条件

- 01 已完成。
- 已阅读编辑器选型笔记，以及以下文件：`editor-model.ts`、`script-commands.ts`、`editor-extensions.ts`、`block-handle.tsx`、`script-editor.tsx`、`scene-chips.ts`、`decorations.ts`、`outline.tsx`、`review-popover.tsx`、`conversion-banner.tsx`、`script-page.tsx`；`lib/desktop-bridge.ts` 和 `lib/project-queries.ts` 中偏好的读写方式。

## 步骤

- [x] T1 修改 `editor-model.ts`：
  - 文档的 `preface` 和 `appendix` 放在 doc 节点的 attrs 中，不作为可编辑节点；
  - `scriptBlock` 的 attrs 要能承载新的 SceneAttrs、CharacterAttrs、TagAttrs；
  - `toEditorJson` 接受 v2，`fromEditorJson` 输出 v2。

  — 验证：`editor-model.test.ts` 中，两份样例的规则解析结果，以及一份覆盖全部 12 种类型和各自 attrs 的人工文档（前言、附录都不为空），往返后完全相同。
- [x] T2 修改 `script-commands.ts`：
  - `TYPE_CYCLE` 改为笔记中的新顺序，不含 act；
  - `NEXT_TYPE` 增加 `production: 'action'`；
  - `setBlockType(type)` 改为用 `retypeBlock` 生成替换段落，在一个 transaction 中完成替换，并按 retypeBlock 的返回结果放置光标；
  - `review-popover.tsx` 中的候选项也改为调用它。

  Ctrl+1～9 的映射不变。

  — 验证：`script-commands.test.ts` 更新，覆盖以下几点：
  - Tab 循环一整圈，不出现 act，经过 production；
  - 把文本为 `**1. 内景　X — 夜**` 的 action 段落设为 scene，attrs 中 space 为 int、time 为 night、timeText 为「夜」，text 为「X」；
  - 把「林夏：你好」设为 character，得到两个段落，一次撤销即可恢复；
  - 已有的 Enter 映射等用例继续通过。
- [x] T3 修改类型下拉框和段落手柄菜单：选项为 `BLOCK_TYPES` 去掉 act。光标在 act 段落上时，下拉框显示「幕」为当前值，并且这一项禁用。

  修改 `outline.tsx`：
  - 每一场的菜单增加「在此场前插入分幕」，按笔记计算 N，插入后聚焦，可以一次撤销；
  - 幕分组标题的菜单提供「移除分幕」。

  — 验证：组件测试覆盖以下几点：
  - 下拉框中没有「幕」选项；光标在 act 上时，下拉框的值为 act，并且这一项禁用；
  - 在第 2 场前插入分幕后，大纲中出现两个分组，一次撤销后恢复；
  - 「移除分幕」只删除这一个 act 段落。
- [x] T4 排版（`scene-chips.ts`、`script-editor.css`）：
  - 场标题依次显示：场号、内外 chip、地点、时间 chip（有 timeText 时显示 timeText）、note（灰色）、timecode（灰色等宽字体）；点击 chip 切换时，同时把 timeText 设为 null；
  - 角色：显示名字、delivery chip、extension（灰色）；
  - sound：喇叭图标加上 label；
  - production：`muted` 底色的 label 徽标，正文使用次要文字颜色；
  - 大纲中的时间显示 timeText 优先。

  所有颜色都只用 token 和 `var(--tag-*)`。

  — 验证：组件测试覆盖以下几点：
  - 样例 02 中第 1 场的标题渲染出「内景」「城西卢宅·正屋」「清晨」「多年以后」「00:00–00:35」；
  - 点击时间 chip 后，timeText 为 null，time 发生变化；
  - production 段落渲染出 label「镜头」。
- [x] T5 前言和附录卡片：
  - 纸面的上方和下方各有一块默认折叠的卡片，分别是「前言」和「附录」，内容为空时不显示；
  - 摘要为第一行非空文字，展开后以 `whitespace-pre-wrap` 显示；
  - 卡片中的「在 Markdown 视图中编辑」按钮先实现为切换 `scriptView` 偏好，Markdown 视图本身由 05 实现，在 05 完成之前，这个按钮暂时隐藏。

  — 验证：组件测试覆盖以下几点：前言为空时没有卡片；不为空时显示摘要，点击后展开显示全文。
- [x] T6 元素标记：
  - `decorations.ts` 支持两种模式：只为选中的元素生成下划线，或者为全部元素生成；
  - `scriptMentions` 偏好通过 `preferencesQuery` 读取，通过 `setPreferences` 写入；
  - 工具栏增加「元素标记」切换按钮（`aria-pressed`），收进「更多」菜单时同样可用；
  - 悬停卡片和 Ctrl+点击只对有下划线的位置生效；
  - 存疑竖条不受这个开关影响。

  — 验证：
  - `decorations.test.ts`：关闭模式且没有选中元素时，没有 mention 装饰；选中一个元素后，只有它有装饰；开启模式下的结果与原有行为一致；
  - 组件测试：点击「元素标记」后，调用 `setPreferences({ scriptMentions: true })`，并且 `aria-pressed` 为 true。
- [x] T7 修改 `conversion-banner.tsx`：结果提示改为「已识别 S 场、B 段，新增 N 个元素」，同时更新 `conversion-banner.test.tsx` 和 `script-page.test.tsx` 中的预期文字。

  — 验证：两个测试文件通过。

## 验证

- 预期：
  - `pnpm --filter @frame-loom/desktop typecheck` 通过；
  - `pnpm --filter @frame-loom/desktop exec vitest run --project renderer src/renderer/src/features/projects/script` 通过；
  - 对改动的文件运行 `pnpm exec eslint` 通过；
  - 在开发模式下，用 `script-sample-02.txt` 导入后，在明暗两种模式下各检查一次场标题、production、前言卡片和元素标记，看到的问题记入「发现与偏差」。

  本子计划不运行 e2e。
- 实际：desktop typecheck、定向 eslint 通过；renderer 剧本单测 78 项通过，05 联调后 82 项通过。开发模式（5173）真实导入样例 02，明暗主题场标题、时间码、production 标签、前言卡片及元素开关均可用；已查看 `.cache/scripts-fix/dev-styled-light.png` 和 `dev-styled-dark.png`，文字没有溢出，使用现有主题 token。

## 进度

- 2026-10-30：创建子计划草稿。
- 2026-10-30：完成 v2 编辑器、类型重解析、大纲分幕、排版、卡片和元素开关。

## 发现与偏差

无。

## 交接

代码、定向测试和开发模式明暗原生界面检查完成。05 接通前言附录编辑，06 继续生产构建验收。
