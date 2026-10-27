# Plan: 验收与收尾

Status: draft
Parent: plan.md

## 目标

用端到端测试和人工检查证明标签功能完整可用，同步相关笔记，并将笔记与计划转入完成状态。

## 前置条件

- 04 完成。

## 步骤

- [ ] T1 新增 `apps/desktop/e2e/project-tags.test.ts`：
  - 在两个创作页给节点打同一个标签，在其中一页删除该标签。
  - 弹窗「全部改为」其他标签后删除成功。
  - 重启后两页徽标正确。
  - 自定义标签改名后，另一页同步显示。

  — 验证：`pnpm --filter @frame-loom/desktop e2e -- project-tags`
- [ ] T2 人工检查以下项目，截图存入 `.cache/project-tags/` 并逐图核对：明暗两种模式、720×560、键盘路径（菜单 → 卡片 → 编辑和删除图标 → 弹窗）、锁定节点置灰、错误状态 — 验证：截图清单
- [ ] T3 原地同步[项目库](../../notes/implemented/feature/2026-10-26-project-library.md)的清单格式、[无限画布](../../notes/implemented/feature/2026-10-25-infinite-canvas.md)的 host 和节点头部、[共享契约](../../notes/implemented/architecture/2026-10-24-shared-contracts.md)，以及 `docs/ui-guidelines.md` 的标签 token 说明 — 验证：`pnpm run verify`
- [ ] T4 将项目标签笔记移入 `implemented/feature/`，并改写为现在时；父子计划转 `done` — 验证：`pnpm test`、`pnpm typecheck`、`pnpm lint`、`pnpm format:check`、`pnpm run verify`

## 验证

- 预期：全仓门禁与 e2e 通过，人工检查清单完成。
- 实际：未执行。

## 进度

- 2026-10-27：创建子计划草稿。

## 发现与偏差

无。

## 交接

尚未开始，等待 04。
