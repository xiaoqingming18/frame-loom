# Plan: 画布骨架

Status: active
Parent: plan.md

## 目标

- `packages/canvas`（`@frame-loom/canvas`）以源码形式导出 `CanvasEditor`，依赖 `@xyflow/react` 12.12.0 与 `zustand` 5.0.16（精确锁定）。
- desktop 左栏新增「画布测试」，路由 `/canvas-lab` 铺满主区、不滚动，显示 24px 随视口移动的点阵背景与空画布提示。
- 底部操作栏（添加、指针、框选、抓手、撤销、重做、帮助）、右上工具组（缩放比例、按类型整理、按布局整理、连线显示、小地图）与右上小地图按参考稿风格实现，颜色全部来自主题 token。
- 工具状态机与快捷键层：空格临时抓手、滚轮缩放 10%–400%、Shift+1、Shift+0、M、Esc；可编辑元素和输入法组字时不触发。

## 前置条件

- 01 完成。

## 步骤

- [ ] T1 创建包结构、package.json、tsconfig、vitest、ESLint 与 Tailwind 扫描配置；导入 `@xyflow/react/dist/base.css` 并映射 `--xy-*` — 验证：`pnpm typecheck`、`pnpm lint` 覆盖新包
- [ ] T2 `theme.css` 新增端口类型色、分组色、警告色、小地图遮罩与三组浮层阴影（明暗成对）— 验证：明暗截图目检
- [ ] T3 store、工具状态机、快捷键层与单测 — 验证：快捷键判定单测通过
- [ ] T4 操作栏、右上工具组、小地图、空画布提示、缩放下拉 — 验证：组件测试；720×560 与明暗截图
- [ ] T5 desktop 路由、侧栏入口、外壳在画布页去掉 `canvas-grid` 与滚动 — 验证：路由测试与 e2e 打开画布页

## 验证

- 预期：新包单测与 desktop 测试通过；开发环境明暗截图符合参考稿风格。
- 实际：未执行。

## 进度

- 2026-10-25：创建子计划草稿。

## 发现与偏差

无。

## 交接

等待 01 完成。
