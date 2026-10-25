# Plan: 画布骨架

Status: done
Parent: plan.md

## 目标

- `packages/canvas`（`@frame-loom/canvas`）以源码形式导出 `CanvasEditor`，依赖 `@xyflow/react` 12.12.0 与 `zustand` 5.0.16（精确锁定）。
- desktop 左栏新增「画布测试」，路由 `/canvas-lab` 铺满主区、不滚动，显示 24px 随视口移动的点阵背景与空画布提示。
- 底部操作栏（添加、指针、框选、抓手、撤销、重做、帮助）、右上工具组（缩放比例、按类型整理、按布局整理、连线显示、小地图）与右上小地图按参考稿风格实现，颜色全部来自主题 token。
- 工具状态机与快捷键层：空格临时抓手、滚轮缩放 10%–400%、Shift+1、Shift+0、M、Esc；可编辑元素和输入法组字时不触发。

## 前置条件

- 01 完成。

## 步骤

- [x] T1 创建包结构、package.json、tsconfig、vitest、ESLint 与 Tailwind 扫描配置；导入 `@xyflow/react/dist/base.css` 并映射 `--xy-*` — 验证：`pnpm typecheck`、`pnpm lint` 覆盖新包
- [x] T2 `theme.css` 新增端口类型色、分组色、警告色、小地图遮罩与三组浮层阴影（明暗成对）— 验证：明暗截图目检
- [x] T3 store、工具状态机、快捷键层与单测 — 验证：快捷键判定单测通过
- [x] T4 操作栏、右上工具组、小地图、空画布提示、缩放下拉 — 验证：组件测试；720×560 与明暗截图
- [x] T5 desktop 路由、侧栏入口、外壳在画布页去掉 `canvas-grid` 与滚动 — 验证：路由测试与 e2e 打开画布页

## 验证

- 预期：新包单测与 desktop 测试通过；开发环境明暗截图符合参考稿风格。
- 实际：
  - `packages/canvas` 33 项测试通过（含 store、快捷键、布局、剪贴板、操作栏和视图工具组件）；`packages/contracts` 100 项通过；desktop 131 项通过。
  - `pnpm lint`、`pnpm typecheck`、`pnpm format:check`、`pnpm run verify` 通过。
  - 最新 desktop build 通过；清除 `ELECTRON_RUN_AS_NODE` 后 `canvas-shell.test.ts` 通过，1 项桌面 e2e 覆盖浅色／深色、空白区焦点、指针／框选／抓手、空格临时平移、中键平移、滚轮与 10%–400% 缩放档位、M 小地图、N 添加菜单、Help/Dialog Portal 快捷键隔离、720×560 最小窗口与返回项目库后的外壳滚动状态。
  - 截图证据：`apps/desktop/test-results/canvas-shell-画布骨架：主题、最小窗口、工具焦点与视口快捷键/` 下的 `canvas-shell-light.png`、`canvas-shell-dark.png`、`canvas-shell-minimum-light.png`、`canvas-shell-minimum-dark.png`。截图已检查，右上工具组与 180×120 小地图不重叠，明暗主题 token 生效，最小窗口工具栏不越界。
  - engine 单独重跑 144 项通过；此前一次 LLM 集成超时是既有偶发测试，重跑通过。

## 进度

- 2026-10-25：创建子计划。
- 2026-10-25：完成 T1–T4；完成 package、主题、store、快捷键、剪贴板、布局和操作栏基础实现。
- 2026-10-25：完成 T5；接入 `/canvas-lab`、侧栏入口、画布满幅布局和骨架 e2e。
- 2026-10-25：修复画布基础 CSS 层顺序、浮层小地图位置、画布区域焦点、事件捕获、Space 释放和指针／中键平移配置；新增操作栏组件测试。

## 发现与偏差

- 画布包中已包含部分节点、连线、分组、整理和剪贴板代码，属于 03/04 的施工草稿；本子计划只验收骨架能力。节点重命名、真实媒体连线与完整节点 e2e 留给 03。
- React Flow 的 `base.css` 由 `packages/canvas/src/styles.css` 以 `layer(base)` 导入，画布覆盖规则位于 components 层，避免默认 `.react-flow__pane.draggable` 光标和默认变量覆盖项目 token。
- `onlyRenderVisibleElements`、节点播放器上限、视频封面 CORS、engine 持久化和生成任务仍未在本子计划验收。
- 运行桌面 e2e 前必须清除宿主继承的 `ELECTRON_RUN_AS_NODE=1`，否则 Electron 会按 Node 启动并报 `Process failed to launch`；该环境约束已记录在 01 子计划与 desktop README。

## 交接

02 已完成；下一步进入 03，重点验证图片／视频节点上传、端口连线、剪贴板、撤销重做和真实节点 e2e。持久化仍由 05 负责。
