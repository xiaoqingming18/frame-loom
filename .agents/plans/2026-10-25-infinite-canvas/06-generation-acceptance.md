# Plan: 节点内生成与验收

Status: draft
Parent: plan.md

## 目标

- 图片、视频节点内生成：模型、提示词、视频方式、档案参数；连线映射为 `GenerationInput`；`source: 'canvas'`；结果追加为新版本；`pendingJobId` 补写；删除生成中节点时可放弃任务；第三层（模型能力）校验提示。
- 删除模型测试页的路由、feature 与侧栏入口，engine 接口保留。
- 完成提案的人工验收，笔记转入 `implemented/`，计划收尾。

## 前置条件

- 04、05 完成。

## 步骤

- [ ] T1 `CanvasGenerationHost` 与节点生成区 — 验证：组件测试覆盖请求映射与版本写回
- [ ] T2 e2e：模拟供应商下生成图片、图片作首帧生成视频 — 验证：e2e 通过
- [ ] T3 删除模型测试页并迁移仍需要的测试 — 验证：`pnpm lint`、`pnpm test` 通过
- [ ] T4 人工验收 7 项（开发环境与加固 exe，明暗模式）— 验证：截图与记录保存在 `.cache/`
- [ ] T5 收尾：笔记转入 `implemented/feature/`，同步相关笔记与 `docs/ui-guidelines.md`，计划转 `done` — 验证：`pnpm run verify` 通过

## 验证

- 预期：全仓门禁、e2e 与人工验收通过。
- 实际：未执行。

## 进度

- 2026-10-25：创建子计划草稿。

## 发现与偏差

无。

## 交接

等待 04、05 完成。
