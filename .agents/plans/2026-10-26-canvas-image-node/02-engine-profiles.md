# Plan: 图片档案与适配器

Status: done
Parent: plan.md

## 目标

- `apps/engine/src/modules/generation/profiles/image-profiles.ts` 按模型族提供档案：GPT Image 1、GPT Image 2、GPT Image 2.5、Gemini 2.5 Flash Image、Gemini 3 Pro Image、Gemini 3.1 Flash Image、Seedream 4.0、Seedream 4.5，以及三个通用档案；取值与笔记中的能力表一致。
- 档案匹配为最长前缀，`profileId` 显式指定优先。
- `openai-images.ts`、`gemini-image.ts`、`ark-images.ts` 用 01 的换算函数生成请求体，不再整体展开 `request.params`。
- 产物 mime 与实际格式一致。

## 前置条件

- 01 完成。

## 步骤

- [x] T1 重写图片档案定义与 `imageProfile()` 前缀匹配，必要时同步 `apps/engine/src/modules/generation/profiles/media-profiles.ts` — 验证：单测覆盖 `gpt-image-2.5-flare-2026-09-08`→2.5、`gpt-image-2-2026-04-21`→2、`chatgpt-image-latest`→1、未知 id→通用、`profileId` 优先
- [x] T2 OpenAI 适配器：`size`、`quality`、`background`，透明时 `output_format: 'png'`；edits 路径同样适用 — 验证：`apps/engine/src/modules/generation/adapters/fixtures/openai-images.json` 固件与 `images.test.ts` 断言请求体
- [x] T3 Gemini 适配器：`imageConfig.aspectRatio`，档案有 `resolution` 时发 `imageSize` — 验证：固件断言 2.5 Flash 不含 `imageSize`、3 Pro 含 `"4K"`
- [x] T4 Seedream 适配器：像素 `size` 与 `watermark` — 验证：固件断言 4.5 的 2K 16:9 为 `2848x1600`，档案外键不进入请求体
- [x] T5 核实 `image-response.ts` 的产物 mime 与 `media.service.ts` 入库识别，修正为按实际格式 — 验证：Seedream jpeg 固件入库后 mime 为 `image/jpeg`
- [x] T6 原地同步[模型管理](../../notes/proposed/architecture/2026-10-24-model-management.md)中 `matchIds` 与图片档案的事实 — 验证：`pnpm run verify`

## 验证

- 预期：engine 单测、集成测试、typecheck、lint 通过。
- 实际：Node 24.22.0／pnpm 12.15.0 下，`pnpm --filter @frame-loom/engine test` 通过（19 文件、160 项，含 JPEG 入库集成测试）；随后增加白名单边界用例，`pnpm --filter @frame-loom/engine exec vitest run src/modules/generation/adapters/images.test.ts` 通过（1 文件、16 项）。
- 静态检查：`pnpm --filter @frame-loom/engine typecheck`、`pnpm lint`、`pnpm format:check`、`pnpm run verify`、`git diff --check` 通过；笔记门禁检查 19 篇、计划门禁检查 34 份。
- 未执行真实供应商冒烟；仍由模型管理验收持有。

## 进度

- 2026-10-26：创建子计划草稿。
- 2026-10-26：完成 T1–T6，补齐 11 份档案、最长前缀匹配、三个适配器的请求固件和 JPEG 下载入库测试；父计划表与两篇相关笔记同步。整体笔记保留 proposed，待 06 收尾转 implemented。

## 发现与偏差

- 实际创建任务使用 `mediaProfile()`，因此图片分支改为复用 `imageProfile()`；视频与 TTS 精确匹配保持现状。
- `AdapterContext.profile` 传递任务创建时保存的档案快照，防止显式通用档案在适配器内按模型 ID 重新匹配而改变能力。
- 图片由 `MediaService` 直接读取文件头并通过 `image-size` 识别，不经过 `probeMedia`。该实现已支持 JPEG，无需重写；集成测试故意以 PNG Content-Type 返回 JPEG 字节，确认 MIME、扩展名和落盘内容均按真实格式处理。
- 保留旧三个 `*-default` 档案 ID，分别归属 GPT Image 1、Gemini 2.5 Flash、Seedream 4.0；显式选择优先。

## 交接

本子计划无剩余任务。04 可直接使用 `GET /model-profiles` 的语义参数与 `notes` 驱动面板；旧节点原始参数的回退、清除与提示仍由后续画布接入完成。
