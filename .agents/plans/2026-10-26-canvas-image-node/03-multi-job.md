# Plan: 多任务数据与运行时

Status: done
Parent: plan.md

## 目标

- `CanvasMediaData` 支持 `pendingJobIds: uuid[]`（最多 4）与 `count: 1–4`；过渡期 schema 仍接受旧 `pendingJobId`。
- `packages/canvas/src/nodes/builtin.tsx` 中图片、视频节点 `version` 升到 2，`migrate` 把 `pendingJobId` 转为单元素数组。
- 提交 N 个任务；运行时、写回、删除确认、放弃任务按数组工作；失败项可经 `resubmit` 单张重试。
- 切换模型使用 `resolveImageParams`，有调整时 `notify` 提示。

## 前置条件

- 01 完成。

## 步骤

- [x] T1 修改 `packages/contracts/src/canvas.ts` 的 `CanvasMediaData` — 验证：contracts 单测覆盖新旧字段、上限
- [x] T2 节点迁移与 `typeVersion` 2 — 验证：画布单测加载旧文档后 `pendingJobIds` 正确、数据其余字段不变
- [x] T3 `generation-runtime.tsx`、`generation-writeback.ts`、`components/use-actions.ts` 改为数组；写回仍以 `version.jobId` 去重 — 验证：单测覆盖多个任务乱序完成、重复事件、部分失败、历史快照补写
- [x] T4 提交逻辑：按 `count` 连续创建任务、记录每个任务 id、单张重试调用 `resubmit` 并替换对应 id — 验证：组件测试断言创建次数与重试后的 id 列表
- [x] T5 切换模型调用 `resolveImageParams` 并提示 — 验证：目标档案不支持 21:9 时回退为 16:9 并提示；支持时保留且不提示

## 验证

- 预期：contracts 与 canvas 单测通过，现有画布 e2e 不回退。
- 实际：`pnpm test` 全仓通过；随后补充的组件用例经 `pnpm --filter @frame-loom/canvas test`（75 项）和 `pnpm --filter @frame-loom/desktop test`（136 项）通过，contracts 141 项、engine 161 项通过。
- `pnpm typecheck`、`pnpm lint`、`pnpm format:check`、`pnpm run verify` 与桌面构建均通过。
- `pnpm --filter @frame-loom/desktop test:e2e -- canvas-shell.test.ts canvas-nodes.test.ts canvas-organize.test.ts canvas-persistence.test.ts generation-image.test.ts` 中 6 项画布回归通过；图片用例原断言依赖 02 已移除的供应商字段 `n: 1`，同步为尺寸断言并扩展三张生成、部分失败和单张重试后，单独运行 `generation-image.test.ts` 通过（合计 7 项）。
- 检查 `apps/desktop/test-results/` 下图片生成用例的明亮、暗黑与 720×560 截图，未新增水平溢出；本期保留原表单外观。未执行加固 exe 或真实供应商验收。

## 进度

- 2026-10-26：创建子计划草稿。
- 2026-10-26：完成 T1–T5；补齐三种旧节点入口迁移、宿主重试接口、最长前缀档案匹配和相关测试，子计划转 done。

## 发现与偏差

- 原 T5 示例与 02 已落地档案不一致：Gemini 2.5 支持 21:9，实际应保留。改为分别验证目标档案支持时保留、不支持时就近回退，未收窄真实档案。
- 注册表原来仅声明 `migrate`，没有调用入口；本次补齐持久化加载、JSON 导入、剪贴板迁移，并将“未来版本”测试改为 v3。
- 失败任务必须保留引用才能重启恢复单张重试；成功、取消或主动放弃失败项才移除引用。连续创建遇到异常停止后续创建，保留此前成功创建的任务。
- 宿主仍按精确 ID 选图片档案，会使快照模型与 engine 的能力不一致；本次同步图片最长前缀匹配，视频保持精确匹配，增加宿主测试。

## 交接

无。
