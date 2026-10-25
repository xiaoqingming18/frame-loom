# Plan: 持久化

Status: draft
Parent: plan.md

## 目标

- engine `modules/canvas`：`canvas_documents` 表与迁移，`GET /canvases/:id`、`PUT /canvases/:id`（revision、409）、`PUT /canvases/:id/view`。
- renderer 宿主实现：加载、防抖 1 秒保存、离开前保存、保存状态、409 提示重新加载或导出。

## 前置条件

- 03 完成。

## 步骤

- [ ] T1 schema、迁移、repository、service、controller — 验证：engine 集成测试（真实 SQLite）覆盖创建、读取、revision、409、上限与 `data` 校验、视图保存
- [ ] T2 `features/canvas-lab` 宿主的 documents 实现与保存状态 — 验证：组件测试使用替身 client
- [ ] T3 桌面 e2e：保存后重启应用，内容与视口保留 — 验证：e2e 通过

## 验证

- 预期：engine 集成测试与 e2e 通过。
- 实际：未执行。

## 进度

- 2026-10-25：创建子计划草稿。

## 发现与偏差

无。

## 交接

等待 03 完成。
