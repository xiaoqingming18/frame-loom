# Plan: @ 引用参考

Status: done
Parent: plan.md

## 目标

按笔记"@ 引用参考"一节在图片节点实现：

- 轻量 contentEditable 编辑器：纯文本加原子标签，粘贴清除格式，退格整块删除，`isComposing` 期间不触发菜单、不响应画布快捷键。
- 候选列表两组：已连入参考、画布上其他有产物的图片节点；成环／不兼容置灰，参考达上限时第二组置灰。
- 选中未连线节点时建线并插入标签，合并为一步撤销。
- 头部缩略图拖动调整 `inputOrder`，标签编号同步；连线删除后标签失效并禁用发送。
- 提交时用 01 的替换函数生成最终提示词，字数按替换后计数。

## 前置条件

- 04 完成。

## 步骤

- [x] T1 编辑器组件：`@{nodeId}` 与标签双向转换、粘贴、退格、输入法 — 验证：组件测试覆盖往返序列化、粘贴富文本、组字期间输入 `@`
- [x] T2 候选列表与键盘导航，接入 `checkConnection` 与档案参考上限 — 验证：组件测试断言置灰原因
- [x] T3 建线加插入标签的组合命令 — 验证：`commands.test.ts` 断言一步撤销同时移除连线与标签
- [x] T4 缩略图拖动排序与失效检测 — 验证：组件测试断言编号随顺序变化、删除连线后发送按钮禁用
- [x] T5 提交时替换引用 — 验证：组件测试断言中文提示词提交"图2"、英文提示词提交"Image 2"，与 `inputs` 顺序一致

## 验证

- 预期：canvas 单测通过；人工检查中文输入法组字在 06 中完成。
- 实际：`pnpm test` 通过（contracts 141、engine 161、canvas 当时 86、desktop 136 项）；补充边界用例后 `pnpm --filter @frame-loom/canvas test` 89 项通过。`pnpm typecheck`、`pnpm lint`、`pnpm format:check`、`pnpm run verify` 通过。
- 桌面回归：`pnpm run package:prepare` 构建后运行 `generation-image.test.ts`、`canvas-shell.test.ts`、`canvas-organize.test.ts`、`canvas-persistence.test.ts`，分批共 5 项通过。真实 Chromium 覆盖 @ 选入、一步撤销／重做、中文替换后 multipart 请求、多任务与视频回归、重启保留。
- 明暗自查：`.cache/canvas-image-node/mentions-{light,dark}.png`、`mentions-small-{light,dark}.png`；720×560 下参考列表保持画布宽度内，输入框沿用受限高度与整体滚动。原生中文输入法、加固 exe 与完整人工验收仍留给 06。

## 进度

- 2026-10-26：创建子计划草稿。
- 2026-10-26：完成 T1–T5，复用文档历史和共享引用替换函数，新增编辑器、组合命令及引用组件测试；桌面请求与明暗截图通过验证。

## 发现与偏差

- 未引入富文本依赖；图片使用 contentEditable，视频继续复用原 Textarea 外壳，不开放引用语法。
- 排序补齐未登记边的稳定尾排规则；头部提供 Alt 加左右方向键作为拖动排序的键盘入口。原始标记和替换文本均检查 32000 字上限，避免粘贴或短节点 id 替换后超出契约。
- 首轮桌面用例在新增节点时误双击到视频输入框，改用既有“添加节点”入口；骨架回归首轮中键平移断言偶发失败，复跑通过，未修改无关平移逻辑。

## 交接

无。05 已完成；整体笔记仍为 proposed，父计划仍为 active。06 继续完成原生输入法、加固产物、完整验收与笔记收尾；本次改动尚未提交。
