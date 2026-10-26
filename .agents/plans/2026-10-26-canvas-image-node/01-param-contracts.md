# Plan: 统一参数契约

Status: draft
Parent: plan.md

## 目标

`packages/contracts` 提供 engine 与画布共用的图片参数语义和纯函数：

- 语义参数键 `aspectRatio`、`resolution`、`quality`、`background` 的取值常量与界面标签。
- `ModelProfile.params[].notes` 可选字段。
- 尺寸换算 `imageRequestSize`：GPT Image 1 查表、GPT Image 2／2.5 公式、Seedream 官方表加公式夹紧；Gemini 不换算。
- 参数回退 `resolveImageParams(profile, current)` 返回 `{ params, changes }`。
- 引用替换：解析 `@{nodeId}`、按 `inputs` 顺序编号、按提示词是否含汉字选择"图N"／"Image N"、检出失效引用。

## 前置条件

- 无。

## 步骤

- [ ] T1 在 `packages/contracts/src/generation.ts` 增加 `notes`，新增 `packages/contracts/src/image-params.ts` 定义语义取值与标签 — 验证：`pnpm --filter @frame-loom/contracts typecheck`
- [ ] T2 实现 `imageRequestSize`，Seedream 8 个官方比例写入常量表 — 验证：表驱动单测覆盖 14 比例 × 3 档的 OpenAI 四条约束、比例误差 < 1%，Seedream 官方值相等、其余比例满足 4.0／4.5 范围
- [ ] T3 实现 `resolveImageParams` — 验证：单测覆盖比例对数距离就近、清晰度降档、画质就近、透明回退、未知键丢弃、`changes` 文案数据
- [ ] T4 实现引用解析与替换纯函数 — 验证：单测覆盖中英判断、`inputOrder` 编号、同节点多次引用、失效引用、无引用原样返回
- [ ] T5 导出并补充 `checkGenerationRequest` 对语义参数的拒绝用例 — 验证：`pnpm --filter @frame-loom/contracts test`

## 验证

- 预期：contracts 单测、typecheck、lint 通过。
- 实际：未执行。

## 进度

- 2026-10-26：创建子计划草稿。

## 发现与偏差

无。

## 交接

尚未开始；从 T1 开始。
