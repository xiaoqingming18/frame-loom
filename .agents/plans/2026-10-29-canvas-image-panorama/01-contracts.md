# Plan: 全景配方与尺寸规划

Status: done
Parent: plan.md

## 目标

`packages/contracts` 提供 `ImageEditRecipe` 的 `panorama` 分支、engine 与 canvas 共用的 `planPanoramaSize(cap, tier?)`，以及 `imageEditSupport(...).panorama`，规则见笔记「契约」一节。

## 前置条件

- 无。

## 步骤

- [x] T1 在 `packages/contracts/src/image-edit.ts` 增加 `operation: 'panorama'`（`sceneHint` ≤500 字符、可选 `tier`、可选 `geometry`） — 验证：新配方可解析，多余字段被拒绝，旧三种配方解析不变
- [x] T2 在 `packages/contracts/src/edit-geometry.ts` 实现 `planPanoramaSize`：pixels＋custom 候选过滤与默认 2880×1440；tier／ratio 只接受 2:1 ±1% 的已启用格；none／auto 返回不可用原因 — 验证：OpenAI 模板得 2880×1440；Seedream 模板过滤 2048×1024；Gemini 默认模板不可用；手工加入 2:1 格的 tier 卡可用
- [x] T3 `imageEditSupport` 增加 `panorama` 判定（参考图 ≥1 且尺寸有解） — 验证：`image-edit.test.ts` 覆盖可用与两种不可用原因
- [x] T4 导出新函数和类型 — 验证：`pnpm --filter @frame-loom/contracts test` 与 `pnpm run typecheck` 通过

## 验证

- 预期：contracts 单测、类型检查通过；所有规划结果都能通过 `resolveImageSize(cap, params, true)`，没有 issue。
- 实际：`pnpm --filter @frame-loom/contracts test`：18 文件、253 项通过；全仓 `pnpm run typecheck` 通过。模板、严格配方、参考图限制、手工像素／tier／ratio 格与导出已覆盖。

## 进度

- 2026-10-29：创建子计划草稿。

- 2026-10-29：全部步骤完成并通过上述验证。

## 发现与偏差

无。

## 交接

无。
