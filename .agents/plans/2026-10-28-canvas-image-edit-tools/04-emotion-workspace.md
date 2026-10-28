# Plan: 表情工作区与人脸预览

Status: draft
Parent: plan.md
Note: ../../notes/proposed/feature/2026-10-28-canvas-image-edit-tools.md

## 目标

提供本地人脸检测、覆盖层和手动框选、当前单人角色选择、情绪定位盘及 Morph Target 头部预览；提交与 02 的 engine 表情任务契约对接。

## 前置条件

- 01 完成，表情参数／来源快照契约稳定。
- 阅读 `packages/canvas/src/nodes/views.tsx`、`canvas-editor.tsx`、`host.ts`、desktop `security.ts`、`electron.vite.config.ts`，以及 BeefTV 对应 worker、面板与情绪算法源码。
- 本地采用 BeefTV 工作室已有检测／3D 资源；只在加固包验证真实加载，不进行授权调查。

## 步骤

- [ ] T1 将检测封装为懒加载 Module Worker，支持取消、错误恢复与零结果状态 — 验证：使用检测替身的单测覆盖响应关联、Abort 和 worker 错误可重试。
- [ ] T2 实现源图对齐的脸框覆盖、角色选择和坐标反算手动框选 — 验证：纯几何测试覆盖 contain 留白、缩放、边界框和最小框尺寸。
- [ ] T3 实现 25 格情绪盘、键盘访问、默认中性及 Morph Target 预览过渡 — 验证：数据驱动纯函数检查 25 组映射；组件测试确认选择与键盘状态，不在单测启动真实 WebGL。
- [ ] T4 处理关闭、源图切版本、移动节点卸载、生成准备失败和 Abort 竞态 — 验证：组件异步测试断言旧源结果不提交，失败后可继续编辑，活动角色单次提交一个 payload。
- [ ] T5 按实际资源加载方式收紧到最小 CSP 变更 — 验证：security 单测断言新增所需来源并保留脚本／连接限制。

## 验证

- 预期：canvas 几何与工作区定向测试、CSP 定向测试；检测和 three.js 使用替身。
- 真实模型、WASM 与 WebGL 加固运行只在 05 做一次；此处不重复截图或启动 Electron。
- 实际：未执行，当前仅计划草稿。

## 进度

- 2026-10-28：创建子计划草稿，未修改代码。

## 发现与偏差

BeefTV 当前行为一次只生成活动角色，关闭整个工作区；源图变化会取消检测，但原实现的生成工件阶段缺少取消／版本校验。计划把已确认的取消准备和快照规则作为 Frame Loom 完整性要求，不复制该竞态。

## 交接

草稿待评审；依赖 01，完成后交 05 进行完整桌面交互及加固资源验收。