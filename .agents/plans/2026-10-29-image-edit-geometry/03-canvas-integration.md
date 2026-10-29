# Plan: 三项编辑的画布接入与清理

Status: draft
Parent: plan.md

## 目标

多角度与重打光按源图比例请求输出，打光面板显示预填尺寸；表情前端预检与 engine 几何一致；三项提示词集中生成；删除 canvas 侧无人调用的表情实现。符合笔记“多角度与重打光”与“表情准备与合成”最后一条。

## 前置条件

- 01 完成。

## 步骤

- [ ] T1 `packages/canvas/src/nodes/image-edit-tools.tsx` 多角度提交时用 `planEditGeometry` 以整图求尺寸写入 `params` — 验证：组件测试断言 `host.generation.create` 收到的 `params` 与源图同比例
- [ ] T2 重打光创建子节点时把同一尺寸预填到子节点 `params`，通用生成面板 `generation-panel.tsx` 正常显示并允许用户修改 — 验证：组件测试断言子节点 `params`；面板尺寸控件显示预填值
- [ ] T3 `emotion-workspace.tsx` 提交前调用 `planEditGeometry` 预检，无解时显示错误并禁用提交 — 验证：Gemini 全部比例禁用的夹具下按钮禁用并显示原因
- [ ] T4 新建按 `recipe` 生成三项提示词的模块，替换 `image-edit-tools.tsx` 与 `emotion-workspace.tsx` 中的内联构建 — 验证：现有提示词快照或断言不变
- [ ] T5 删除 `packages/canvas/src/nodes/image-emotion.ts` 中的 `buildEmotionImageArtifacts`、`compositeEmotionImage`、`emotionGenerationSize`、`normalizeEmotionPromptForProvider` 及只被它们使用的私有函数 — 验证：`pnpm run typecheck` 与 canvas 测试通过，grep 无残留引用
- [ ] T6 检查新增错误提示与尺寸显示在明暗主题下可读 — 验证：两种主题截图人工检查

## 验证

- 预期：canvas 单测、`pnpm run typecheck`、变更文件 ESLint 与 Prettier 通过。
- 实际：未执行。

## 进度

- 2026-10-29：创建子计划草稿。

## 发现与偏差

无。

## 交接

未开始；等待 01 完成后从 T1 开始。
