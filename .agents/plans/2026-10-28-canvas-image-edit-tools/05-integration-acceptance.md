# Plan: 图片编辑联调与整体验收

Status: done
Parent: plan.md
Note: ../../notes/implemented/feature/2026-10-28-canvas-image-edit-tools.md

## 目标

验证 02～04 的组合行为、画布重启保留和加固目录版真实资源加载；按用户要求集中一次运行全仓门禁和必要人工验收，避免子计划重复消耗 Agent Token。

## 前置条件

- 02、03、04 完成，定向测试通过。
- 阅读 `apps/desktop/e2e/generation-image.test.ts`、`project-canvas.fixture.ts`、`apps/desktop/src/main/security.test.ts` 和各子计划验证记录。
- 使用本地模拟供应商；不配置或调用收费供应商。

## 步骤

- [x] T1 增加独立的桌面图片编辑 E2E 主路径 — 验证：`image-node-acceptance.test.ts` 的本地模拟服务断言角度立即提交、打光二阶段提交、表情最终整图及源尺寸。
- [x] T2 验证模型选择、关闭检测、切换源图、任务完成和重启 — 验证：canvas 组件测试覆盖显式选择、Abort、源版本校验；桌面 E2E 覆盖任务持久化、最终单版本和 renderer 重启写回。
- [x] T3 一次运行仓库质量门禁 — 验证：执行 `pnpm run test`、`pnpm run typecheck`、`pnpm run lint`、`pnpm run format:check`、`pnpm run build`、`pnpm --filter @frame-loom/desktop test:e2e`、`pnpm run verify`、`git diff --check` 并记录结果。
- [x] T4 一次构建／启动加固目录版，完成明暗、小窗及本地资源观察 — 验证：在一个会话检查 720×560 与常用窗口、角度／光源交互、人脸覆盖对齐、WASM／Worker／3D 资源和控制台 CSP 错误；合并必要截图，不按每个参数重复拍摄。
- [x] T5 整理实现、测试、缺口与交接事实 — 验证：未执行收费供应商生成；明确记录线上生成质量、全分辨率／显卡矩阵及 NSIS 安装卸载未验证。

## 验证

- 预期：定向桌面 E2E 一次；整仓门禁仅在本子计划一次；加固目录版只构建并启动一次。
- 不进行真实收费生成、NSIS 安装／卸载、跨 GPU 矩阵、任意分辨率压力测试及无差别重复截图。发现具体风险后再提出必要扩测。
- 实际：canvas 组件边界测试 4 项、桌面三功能主路径及 renderer 重启均通过。加固目录版第一次发现 Vite 未复制 public 资源，配置 `publicDir` 后 WASM JS／WASM／人脸模型／GLB 请求均成功；`sharp` x64 二进制随 engine 进入目录包。720×560 下完成资源、主题、检测及 3D canvas 检查。全仓 test、typecheck、lint、format:check、build、verify、git diff --check 通过。桌面 E2E 首轮 17/20；构建并发改写 engine 产物期间三项启动失败，构建后 `pnpm --filter @frame-loom/desktop test:e2e canvas-persistence.test.ts canvas-shell.test.ts` 复跑 3/3 通过。目录包构建通过，sharp 0.34.5 / libvips 8.17.3 在 Windows x64 加载成功。

## 进度

- 2026-10-28：完成模拟供应商三条主路径和重启写回；在 720×560 加固目录版验证 Worker、WASM、3D 资源加载和主题。修正图片编辑工具栏遮挡节点标题的问题；E2E 中另一个视口手势断言的最终复跑结果待记录。

- 2026-10-28：完成全仓门禁及三项失败隔离复跑，补齐快照中间／最终图引用的重启清理回归；笔记转 implemented，全部子计划转 done。收费供应商质量、全分辨率／显卡矩阵和 NSIS 安装卸载未测试。

## 发现与偏差

Vite 默认不复制 `apps/desktop/public` 到 renderer，因此单测及开发构建无法发现打包 Worker／WASM／GLB 丢失；加固目录版资源请求现作为验收门。编辑工具栏位于节点标题相同的负 top 区域会拦截标题双击，现将工具栏上移一档并以持久化 E2E 回归。

2026-10-28 后续诊断发现开发 loader 的 `?import` 转换与历史模型目录能力字段缺失未由上述目录包／手框路径覆盖；保留原验证事实，新增缺口和回归见[运行时修复计划](../2026-10-28-canvas-image-edit-runtime/plan.md)。本轮未重新执行原验收。

## 交接

原实施阶段已完成；后续新缺陷交由独立运行时修复计划，不在本 done 计划中补记为已修复。
