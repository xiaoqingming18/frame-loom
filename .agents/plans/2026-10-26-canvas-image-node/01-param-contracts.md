# Plan: 统一参数契约

Status: done
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

- [x] T1 在 `packages/contracts/src/generation.ts` 增加 `notes`，新增 `packages/contracts/src/image-params.ts` 定义语义取值与标签 — 验证：`pnpm --filter @frame-loom/contracts typecheck`
- [x] T2 实现 `imageRequestSize`，Seedream 8 个官方比例写入常量表 — 验证：表驱动单测覆盖 14 比例 × 3 档的 OpenAI 四条约束、比例误差 < 1%，Seedream 官方值相等、其余比例满足 4.0／4.5 范围
- [x] T3 实现 `resolveImageParams` — 验证：单测覆盖比例对数距离就近、清晰度降档、画质就近、透明回退、未知键丢弃、`changes` 文案数据
- [x] T4 实现引用解析与替换纯函数 — 验证：单测覆盖中英判断、`inputOrder` 编号、同节点多次引用、失效引用、无引用原样返回
- [x] T5 导出并补充 `checkGenerationRequest` 对语义参数的拒绝用例 — 验证：`pnpm --filter @frame-loom/contracts test`

## 验证

- 预期：contracts 单测、typecheck、lint 通过。
- 实际：Node 24.22.0／pnpm 12.15.0 下，`pnpm --filter @frame-loom/contracts test`（10 文件、140 项）、`pnpm --filter @frame-loom/contracts typecheck`、`pnpm --filter @frame-loom/contracts build` 与 `pnpm exec eslint packages/contracts/src` 通过。
- 回归：`pnpm test`、`pnpm typecheck`、`pnpm lint` 通过；格式及笔记／计划门禁结果见下方进度。

## 进度

- 2026-10-26：创建子计划草稿。
- 2026-10-26：完成 T1–T5，新增 40 项测试；父计划保持 active，其余子计划未施工。共享契约笔记同步已实现边界，整项图片节点笔记保留 proposed 至 06 收尾。
- 2026-10-26：`pnpm format:check`、`pnpm run verify`、`git diff --check` 全部通过；笔记门禁检查 19 篇、计划门禁检查 34 份。

## 发现与偏差

- OpenAI 1K 的 5:4、4:5、2:1、1:2 独立取整误差略超 1%，在相邻 ±16 像素组合中选择最近合法值；已同步决策笔记并通过全部 42 组比例／档位约束测试。
- `inputOrder` 存的是边 id；`resolveImagePrompt(prompt, inputNodeIds)` 接收与实际 `inputs` 一一对应的源节点 id 顺序，画布排序留给 05。失效引用保留标记并返回去重的 `missingNodeIds`。
- 数量不属于请求参数，夹紧到 1–4 由 03／04 的节点数据与面板负责；本子计划不提前修改画布数据契约。

## 交接

本子计划无剩余任务。02／03 可开始：尺寸换算按档案是否声明 `resolution` 区分 OpenAI 固定／任意尺寸；Seedream 按是否支持 `1K` 选择面积下限。新档案需声明语义参数后调用，当前旧档案不会自动迁移。`changes` 为 `{ key, from, to, message }[]`，移除参数时 `to` 为 `undefined`；首次补默认值不提示。整体未提交改动需与笔记和计划一并提交。
