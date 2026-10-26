# Plan: 画布接入与画布测试移除

Status: draft
Parent: plan.md

## 目标

- 新路由 `routes/projects.$projectId.pages.$pageId.tsx`：铺满主区，顶部面包屑「项目库 / 项目 / 创作页」与保存状态；外壳全出血判断改为匹配该路由。
- 把 `features/canvas-lab` 的宿主与 `canvas-persistence.ts` 迁入 `features/projects/canvas/`：文档读写改用页面接口，视图改用页面视图接口；媒体上传、URL（`frame-project://<projectId>/media/<sha256>`）、生成请求补入 `projectId`／`pageId`；进入与离开时调用会话接口；离开拦截、关闭等待、409 冲突与导出流程保持现有行为。
- `packages/canvas/src/host.ts` 新增可选 `media.adopt` 与 `assets: { pick, save }`：粘贴与导入 JSON 时先补齐；添加节点菜单与图片节点上传入口增加「从项目资产添加」；节点右键菜单增加「保存到项目资产」；媒体加载失败显示「素材缺失」占位。宿主未提供能力时不显示对应入口。
- 删除 `/canvas-lab` 路由、`features/canvas-lab`、侧栏入口、`apps/engine/src/modules/canvas` 与 `canvas_documents`（新增删除表的迁移）。

## 前置条件

- 03、07 完成。

## 步骤

- [ ] T1 画布包新增 `adopt`、`assets` 与素材缺失占位 — 验证：`pnpm --filter @frame-loom/canvas test` 覆盖粘贴／导入调用 adopt、无宿主能力时入口隐藏、缺失占位保留数据
- [ ] T2 迁移宿主与持久化到项目画布路由 — 验证：持久化单测改用页面 id，revision、冲突、视图分离保存行为不变
- [ ] T3 接入会话、资产选择器与保存到资产对话框 — 验证：组件测试覆盖离开画布后调用 close、选择资产后建节点、保存到资产使用默认文件名
- [ ] T4 删除画布测试与 `modules/canvas`，新增删除表迁移 — 验证：全仓 grep 无 `canvas-lab`、`canvas_documents` 引用（迁移历史除外），`pnpm test` 通过
- [ ] T5 迁移现有画布 e2e 的进入方式（建项目、建页面后进入） — 验证：`pnpm --filter @frame-loom/desktop test:e2e` 原有用例全部通过

## 验证

- 预期：canvas、desktop 单测与现有桌面 e2e 通过。
- 实际：未执行。

## 进度

- 2026-10-26：创建子计划草稿。

## 发现与偏差

无。

## 交接

尚未开始；等待 03、07。
