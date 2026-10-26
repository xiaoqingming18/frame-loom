# Plan: 图片档案与适配器

Status: draft
Parent: plan.md

## 目标

- `apps/engine/src/modules/generation/profiles/image-profiles.ts` 按模型族提供档案：GPT Image 1、GPT Image 2、GPT Image 2.5、Gemini 2.5 Flash Image、Gemini 3 Pro Image、Gemini 3.1 Flash Image、Seedream 4.0、Seedream 4.5，以及三个通用档案；取值与笔记中的能力表一致。
- 档案匹配为最长前缀，`profileId` 显式指定优先。
- `openai-images.ts`、`gemini-image.ts`、`ark-images.ts` 用 01 的换算函数生成请求体，不再整体展开 `request.params`。
- 产物 mime 与实际格式一致。

## 前置条件

- 01 完成。

## 步骤

- [ ] T1 重写图片档案定义与 `imageProfile()` 前缀匹配，必要时同步 `apps/engine/src/modules/generation/profiles/media-profiles.ts` — 验证：单测覆盖 `gpt-image-2.5-flare-2026-09-08`→2.5、`gpt-image-2-2026-04-21`→2、`chatgpt-image-latest`→1、未知 id→通用、`profileId` 优先
- [ ] T2 OpenAI 适配器：`size`、`quality`、`background`，透明时 `output_format: 'png'`；edits 路径同样适用 — 验证：`apps/engine/src/modules/generation/adapters/fixtures/openai-images.json` 固件与 `images.test.ts` 断言请求体
- [ ] T3 Gemini 适配器：`imageConfig.aspectRatio`，档案有 `resolution` 时发 `imageSize` — 验证：固件断言 2.5 Flash 不含 `imageSize`、3 Pro 含 `"4K"`
- [ ] T4 Seedream 适配器：像素 `size` 与 `watermark` — 验证：固件断言 4.5 的 2K 16:9 为 `2848x1600`，档案外键不进入请求体
- [ ] T5 核实 `image-response.ts` 的产物 mime 与 `media.service.ts` 入库识别，修正为按实际格式 — 验证：Seedream jpeg 固件入库后 mime 为 `image/jpeg`
- [ ] T6 原地同步[模型管理](../../notes/proposed/architecture/2026-10-24-model-management.md)中 `matchIds` 与图片档案的事实 — 验证：`pnpm run verify`

## 验证

- 预期：engine 单测、集成测试、typecheck、lint 通过。
- 实际：未执行。

## 进度

- 2026-10-26：创建子计划草稿。

## 发现与偏差

无。

## 交接

尚未开始；等待 01。
