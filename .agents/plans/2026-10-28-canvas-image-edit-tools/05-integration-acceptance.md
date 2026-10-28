# Plan: 图片编辑联调与整体验收

Status: draft
Parent: plan.md
Note: ../../notes/proposed/feature/2026-10-28-canvas-image-edit-tools.md

## 目标

验证 02～04 的组合行为、画布重启保留和加固目录版真实资源加载；按用户要求集中一次运行全仓门禁和必要人工验收，避免子计划重复消耗 Agent Token。

## 前置条件

- 02、03、04 完成，定向测试通过。
- 阅读 `apps/desktop/e2e/generation-image.test.ts`、`project-canvas.fixture.ts`、`apps/desktop/src/main/security.test.ts` 和各子计划验证记录。
- 使用本地模拟供应商；不配置或调用收费供应商。

## 步骤

- [ ] T1 增加独立的桌面图片编辑 E2E 主路径 — 验证：模拟服务断言角度立即提交、打光二阶段提交、表情最终整图、来源连线与快照数据。
- [ ] T2 验证不兼容模型、关闭准备、切换源图、任务完成和重启 — 验证：少量场景分别断言显式选择、Abort 无提交、冻结源图和版本不重复写入；不重跑 02 的任务恢复故障矩阵。
- [ ] T3 一次运行仓库质量门禁 — 验证：执行 `pnpm run test`、`pnpm run typecheck`、`pnpm run lint`、`pnpm run format:check`、`pnpm run build`、`pnpm --filter @frame-loom/desktop test:e2e`、`pnpm run verify`、`git diff --check` 并记录结果。
- [ ] T4 一次构建／启动加固目录版，完成明暗、小窗及本地资源观察 — 验证：在一个会话检查 720×560 与常用窗口、角度／光源交互、人脸覆盖对齐、WASM／Worker／3D 资源和控制台 CSP 错误；合并必要截图，不按每个参数重复拍摄。
- [ ] T5 整理实现、测试、缺口与交接事实 — 验证：未执行收费供应商生成；明确记录线上生成质量、全分辨率／显卡矩阵及 NSIS 安装卸载未验证。

## 验证

- 预期：定向桌面 E2E 一次；整仓门禁仅在本子计划一次；加固目录版只构建并启动一次。
- 不进行真实收费生成、NSIS 安装／卸载、跨 GPU 矩阵、任意分辨率压力测试及无差别重复截图。发现具体风险后再提出必要扩测。
- 实际：未执行，当前仅计划草稿。

## 进度

- 2026-10-28：创建子计划草稿，未修改代码。

## 发现与偏差

无。

## 交接

草稿待评审；待 02～04 完成后集中执行唯一一次整体验收。