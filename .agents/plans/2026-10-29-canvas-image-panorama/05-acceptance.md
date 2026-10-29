# Plan: 集成验收

Status: draft
Parent: plan.md

## 目标

用本地模拟服务和桌面 E2E 证明转全景、查看、截图整条链路可用，完成全量校验，并把笔记移入 `implemented/`。

## 前置条件

- 02、03、04 完成。

## 步骤

- [ ] T1 E2E：OpenAI 模板模拟返回 2:1 PNG → 子节点显示角标 → 打开查看器 → 当前视角截图生成 16:9 节点 — 验证：截图节点尺寸与连线正确
- [ ] T2 E2E：模拟返回 1:1 PNG → 任务成功、诊断可见、无角标 — 验证：断言通过
- [ ] T3 开发模式与 Windows 目录包中加载 `frame-media://` 纹理 — 验证：两种环境都能显示全景，控制台没有 CORS／CSP 错误
- [ ] T4 全量校验 — 验证：`pnpm run typecheck`、`pnpm run lint`、`pnpm run format:check`、`pnpm run build`、`pnpm test`、`pnpm run verify` 通过
- [ ] T5 收尾：笔记改写并移入 `implemented/feature/`，在图片编辑工具笔记补关联，计划转 `done` — 验证：`pnpm run verify` 通过

## 验证

- 预期：上述命令与 E2E 通过；不调用真实模型。
- 实际：未执行。

## 进度

- 2026-10-29：创建子计划草稿。

## 发现与偏差

无。

## 交接

依赖 02、03、04，尚未开始。
