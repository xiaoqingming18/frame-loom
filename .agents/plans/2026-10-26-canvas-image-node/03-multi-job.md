# Plan: 多任务数据与运行时

Status: draft
Parent: plan.md

## 目标

- `CanvasMediaData` 支持 `pendingJobIds: uuid[]`（最多 4）与 `count: 1–4`；过渡期 schema 仍接受旧 `pendingJobId`。
- `packages/canvas/src/nodes/builtin.tsx` 中图片、视频节点 `version` 升到 2，`migrate` 把 `pendingJobId` 转为单元素数组。
- 提交 N 个任务；运行时、写回、删除确认、放弃任务按数组工作；失败项可经 `resubmit` 单张重试。
- 切换模型使用 `resolveImageParams`，有调整时 `notify` 提示。

## 前置条件

- 01 完成。

## 步骤

- [ ] T1 修改 `packages/contracts/src/canvas.ts` 的 `CanvasMediaData` — 验证：contracts 单测覆盖新旧字段、上限
- [ ] T2 节点迁移与 `typeVersion` 2 — 验证：画布单测加载旧文档后 `pendingJobIds` 正确、数据其余字段不变
- [ ] T3 `generation-runtime.tsx`、`generation-writeback.ts`、`components/use-actions.ts` 改为数组；写回仍以 `version.jobId` 去重 — 验证：单测覆盖多个任务乱序完成、重复事件、部分失败、历史快照补写
- [ ] T4 提交逻辑：按 `count` 连续创建任务、记录每个任务 id、单张重试调用 `resubmit` 并替换对应 id — 验证：组件测试断言创建次数与重试后的 id 列表
- [ ] T5 切换模型调用 `resolveImageParams` 并提示 — 验证：组件测试断言 21:9 切到 Gemini 2.5 后为 16:9 且出现提示

## 验证

- 预期：contracts 与 canvas 单测通过，现有画布 e2e 不回退。
- 实际：未执行。

## 进度

- 2026-10-26：创建子计划草稿。

## 发现与偏差

无。

## 交接

尚未开始；等待 01。
