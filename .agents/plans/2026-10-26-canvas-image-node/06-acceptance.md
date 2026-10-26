# Plan: 验收与收尾

Status: draft
Parent: plan.md

## 目标

- 桌面 e2e 覆盖笔记验收第 4 条。
- 开发版与加固 exe 明暗人工验收覆盖笔记验收第 5 条。
- 笔记转入 `implemented/feature/`，无限画布、模型管理笔记原地同步，计划转 `done`。

## 前置条件

- 05 完成。

## 步骤

- [ ] T1 e2e：模拟供应商下 ×3 生成写回 3 个版本、令其中一个失败后单张重试 — 验证：`pnpm --filter @frame-loom/desktop test:e2e`
- [ ] T2 e2e：切换模型回退、@ 引用后请求的提示词与 `inputs` 编号一致、含 `pendingJobId` 的旧文档打开后补写 — 验证：同上
- [ ] T3 人工验收：对照 `docs/design/canvas-image-node.html`，明暗模式、720×560、键盘、中文输入法 — 验证：截图与记录保存到 `.cache/canvas-image-node/`
- [ ] T4 全仓门禁 — 验证：`pnpm test`、`pnpm typecheck`、`pnpm lint`、`pnpm format:check`、`pnpm run verify`
- [ ] T5 收尾：笔记移入 `implemented/feature/` 并改写为现在时，同步[无限画布](../../notes/implemented/feature/2026-10-25-infinite-canvas.md)与[模型管理](../../notes/proposed/architecture/2026-10-24-model-management.md)，修正 `docs/design/README.md` 链接，父子计划转 `done` — 验证：`pnpm run verify`

## 验证

- 预期：e2e、人工验收与全仓门禁通过。
- 实际：未执行。

## 进度

- 2026-10-26：创建子计划草稿。

## 发现与偏差

无。

## 交接

尚未开始；等待 05。
