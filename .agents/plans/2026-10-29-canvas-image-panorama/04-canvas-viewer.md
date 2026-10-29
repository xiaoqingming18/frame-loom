# Plan: 全景查看与截取视角

Status: draft
Parent: plan.md

## 目标

2:1 图片节点显示「720°」角标，可以打开按需加载的全景查看对话框，并截取当前视角或四向视角生成新的图片节点，规则见笔记「产品行为 2、3」和「canvas 与宿主」。

## 前置条件

- 无（只依赖已有图片节点、`host.media.upload` 和 `three@0.185.1`）。

## 步骤

- [ ] T1 新建纯函数模块：`isPanorama(width, height)`、视角到相机朝向、截图尺寸与角分辨率提示 — 验证：单测覆盖 2:1 ±1% 边界、四向朝向和俯仰 ±85° 限制
- [ ] T2 新建 `panorama-viewer.tsx`：动态 `import('three')`，ERP 背景、拖动、方向键、滚轮 FOV、重置；超出 `maxTextureSize` 时等比缩小；关闭时释放 — 验证：jsdom 组件测试 mock three，断言加载、释放调用和键盘交互
- [ ] T3 离屏渲染截图（`WebGLRenderTarget` → `readRenderTargetPixels` → PNG），当前视角与四向两种 — 验证：在 Electron E2E 中检查截图尺寸（由 05 执行）
- [ ] T4 命令层新增批量创建截图子节点与连线的一步撤销命令 — 验证：`commands` 单测覆盖布局、连线和撤销
- [ ] T5 图片节点显示角标和「查看全景」按钮，明暗主题检查 — 验证：组件测试；两种模式截图已查看

## 验证

- 预期：canvas 单测与类型检查通过；真实 WebGL 行为由 05 的 Electron E2E 证明。
- 实际：未执行。

## 进度

- 2026-10-29：创建子计划草稿。

## 发现与偏差

无。

## 交接

可在笔记评审通过后与 01 并行开始。
