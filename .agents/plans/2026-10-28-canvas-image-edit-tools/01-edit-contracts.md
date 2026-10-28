# Plan: 图片编辑契约与媒体引用

Status: done
Parent: plan.md
Note: ../../notes/implemented/feature/2026-10-28-canvas-image-edit-tools.md

## 目标

创建共享、严格校验且版本化的编辑配方，表达源图快照和三类操作能力；确保新媒体引用参与项目恢复、清理和跨项目收养，同时不破坏旧画布。

## 前置条件

- 父计划已 active，用户已授权按计划实施。
- 阅读 `packages/contracts/src/canvas.ts`、`packages/contracts/src/generation.ts`、`packages/contracts/src/model-catalog.ts`、`packages/canvas/src/nodes/builtin.tsx` 及 `apps/engine/src/modules/projects/project-media.service.ts`。
- 仅设计配方和能力契约，不实现 UI 或 engine 图像处理。

## 步骤

- [x] T1 定义严格的角度、打光、表情配方 schema、版本及来源 SHA-256 引用 — 验证：合法边界与缺字段／未知字段 fixture 的 contracts 单测。
- [x] T2 定义图片编辑的参考数、OpenAI Images 门槛、蒙版及无蒙版降级能力并提供共享判定 — 验证：能力组合参数化测试证明 renderer／engine 使用同一结果。
- [x] T3 将编辑快照／中间工件媒体哈希加入项目引用扫描及跨项目收养 — 验证：单一引用收集测试覆盖在途任务源图、工件和终态可清理条件。
- [x] T4 保证旧 CanvasMediaData 文档和既有生成请求仍可解析 — 验证：现有 schema 旧节点 fixture 通过且未知旧节点保持原样。

## 验证

- 预期：`pnpm --filter @frame-loom/contracts test -- canvas.test.ts generation.test.ts image-edit.test.ts`（按实现后的实际文件脚本调整）；engine 项目媒体引用相关单测定向运行。
- 不运行全仓测试、UI E2E 或构建；这些不验证本子计划的新增契约风险。
- 实际：`pnpm --filter @frame-loom/contracts test -- src/image-edit.test.ts src/canvas.test.ts src/generation.test.ts`（26 passed）；`pnpm --filter @frame-loom/engine test -- src/modules/projects/project-content.integration.test.ts`（10 passed）。

## 进度

- 2026-10-28：完成共享配方、能力判断、Canvas 数据契约及项目媒体引用保护；上述定向测试通过。

## 发现与偏差

无。

## 交接

无。
