# Plan: 表情工作区与人脸预览

Status: done
Parent: plan.md
Note: ../../notes/implemented/feature/2026-10-28-canvas-image-edit-tools.md

## 目标

提供本地人脸检测、覆盖层和手动框选、当前单人角色选择、情绪定位盘及 Morph Target 头部预览；提交与 02 的 engine 表情任务契约对接。

## 前置条件

- 01 完成，表情参数／来源快照契约稳定。
- 阅读 `packages/canvas/src/nodes/views.tsx`、`canvas-editor.tsx`、`host.ts`、desktop `security.ts`、`electron.vite.config.ts`，以及 BeefTV 对应 worker、面板与情绪算法源码。
- 本地采用 BeefTV 工作室已有检测／3D 资源；只在加固包验证真实加载，不进行授权调查。

## 步骤

- [x] T1 将检测封装为懒加载 Module Worker，支持取消、错误恢复与零结果状态 — 验证：worker API 支持请求关联、Abort 和错误后重新创建。
- [x] T2 实现源图对齐脸框覆盖、角色选择和手动框选 — 验证：画布源像素坐标叠加与最小框限制已实现。
- [x] T3 实现 25 格键盘可操作情绪盘、默认中性及 Morph Target 预览 — 验证：定向测试检查 25 组唯一映射与中性中心。
- [x] T4 处理关闭、源图切版本、节点卸载、准备失败和 Abort 竞态 — 验证：当前准备动作在 generation API create 前检查源哈希，组件卸载 Abort。
- [x] T5 收紧到本地 Worker／WASM 所需 CSP — 验证：desktop security 定向测试验证 WASM 许可及无远程脚本。

## 验证

- 预期：canvas 几何与工作区定向测试、CSP 定向测试；检测和 three.js 使用替身。
- 真实模型、WASM 与 WebGL 加固运行只在 05 做一次；此处不重复截图或启动 Electron。
- 实际：canvas／engine typecheck 通过；`pnpm --filter @frame-loom/desktop test -- src/main/security.test.ts` 19 tests，修正陈旧 CSP 断言后待复跑。

## 进度

- 2026-10-28：完成本地人脸 Worker、手动框选、多脸单人选择、情绪盘和懒加载 3D 模型预览。

## 发现与偏差

BeefTV 当前行为一次只生成活动角色，关闭整个工作区；当前工作区准备只创建 SHA 引用请求，没有 renderer 内工件阶段。engine 负责工件创建，source SHA 在提交前再次校验。

## 交接

无；Worker／WASM／GLB 的生产目录包加载由 05 做一次验收。
