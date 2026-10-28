# Plan: 多角度与重打光工具

Status: done
Parent: plan.md
Note: ../../notes/implemented/feature/2026-10-28-canvas-image-edit-tools.md

## 目标

在图片节点工具区提供多角度和重打光体验，复刻参数、预览、提示词和各自提交时机，复用现有生成输入框、媒体及可撤销画布操作。

## 前置条件

- 01 完成并提供图片编辑配方、能力及源版本快照契约。
- 阅读 `packages/canvas/src/nodes/views.tsx`、`generation-panel.tsx`、`generation-composer.tsx`、`host.ts`、`commands/commands.ts` 及 `docs/ui-guidelines.md`。
- 原版参数基线：角度默认 45°／0°／4.8／标准镜头；打光默认前向／亮度 50／白光／无轮廓／无风格／智能模式开启。

## 步骤

- [x] T1 增加图片专属工具入口、工作区状态和兼容模型的显式选择 — 验证：模型不兼容提示和显式选择行为已接入面板。
- [x] T2 实现多角度参数、六个预设和 CSS 3D 摄像头预览 — 验证：参数单测覆盖预设仅更改角度并保留距离／镜头。
- [x] T3 实现方向／亮度／颜色／风格／智能描述及提示词模板 — 验证：提示词单测断言方向、亮度、轮廓、颜色、风格与描述。
- [x] T4 完成角度确认即生成、打光创建预填子节点后再由通用输入框发送 — 验证：panel 将节点 `imageEdit` 配方带入 generation request。
- [x] T5 将建子节点与来源连线合为撤销事务并保存操作参数 — 验证：命令测试断言一次撤销同时移除节点与边。

## 验证

- 预期：packages/canvas 新增的参数纯函数、关键面板主路径与命令定向测试。
- 模板只测试约定的会话生命周期；不做每按钮快照、逐预设截图或完整桌面 E2E（由 05 集中执行）。
- 实际：`pnpm --filter @frame-loom/canvas test -- src/nodes/image-edit-parameters.test.ts src/commands/commands.test.ts`（15 passed）；canvas typecheck 通过。

## 进度

- 2026-10-28：完成角度／打光参数工具、配方子节点及提交节奏；模型需显式兼容选择。

## 发现与偏差

原版提示词报告中局部处理公式有文字误述；以 BeefTV 实际源码表达式为准。多角度预览仅为 CSS 交互示意，不承诺真实 3D 重建质量。

## 交接

无；桌面真实交互由 05 验收。
