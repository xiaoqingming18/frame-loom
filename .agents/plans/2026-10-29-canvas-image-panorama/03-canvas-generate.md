# Plan: 转全景入口与提示词

Status: draft
Parent: plan.md

## 目标

图片节点工具区新增「全景」入口和面板，按笔记「产品行为 1」和「生成路线」提交任务，并创建子节点。

## 前置条件

- 01 完成。

## 步骤

- [ ] T1 在 `packages/canvas/src/nodes/image-edit-prompts.ts` 增加全景提示词构造，包含补充描述 — 验证：快照式单测断言 2:1、地平线、左右连续和禁止项都在提示词中，补充描述被追加
- [ ] T2 在 `packages/canvas/src/nodes/image-edit-tools.tsx` 增加「全景」按钮和 Dialog：模型选择、补充描述、清晰度、尺寸预览、不可用原因 — 验证：组件测试覆盖兼容模型、不兼容模型的显式选择和 Gemini 默认模板不可用提示
- [ ] T3 确认后用 `createImageEditChild` 创建子节点并提交任务 — 验证：子节点与连线可一步撤销；配方含源 SHA-256；源版本变化时拒绝
- [ ] T4 明暗主题检查面板 — 验证：两种模式的截图已查看并记录

## 验证

- 预期：`pnpm --filter @frame-loom/canvas test` 与类型检查通过。
- 实际：未执行。

## 进度

- 2026-10-29：创建子计划草稿。

## 发现与偏差

无。

## 交接

依赖 01，尚未开始。
