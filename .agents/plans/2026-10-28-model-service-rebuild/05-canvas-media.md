# Plan: 画布图像与视频

Status: draft
Parent: plan.md

## 目标

图像、视频节点的模型选择、参数面板、视频方式、端口和素材限制全部改为由能力卡和协议规则驱动，提交 `SemanticRequest`。删除画布与 contracts 中写死的参数键、模式白名单和 `ModelProfile` 依赖。现有的语义参数、每张图独立任务、@ 引用、素材槽位布局、「比例 · 时长」入口、`pendingParams` 阻塞、图片编辑工具和写回链路保持行为不变。

## 前置条件

- 01、02、03 已完成。
- 阅读 `docs/ui-guidelines.md` 中画布输入框的相关条目，以及笔记 `implemented/feature/2026-10-26-canvas-image-node.md`、`2026-10-27-video-composer.md`、`2026-10-28-canvas-image-edit-tools.md`。
- 读懂现有实现：
  - `packages/canvas/src/host.ts`
  - `nodes/generation-panel.tsx`、`generation-composer.tsx`、`generation-params.tsx`、`video-param-control.tsx`
  - `nodes/views.tsx`、`video-references.tsx`、`video-reference-picker.tsx`、`generation-inputs.ts`、`media.ts`、`builtin.tsx`
  - `nodes/image-prompt-editor.tsx`、`image-edit-tools.tsx`、`emotion-workspace.tsx`
  - `nodes/generation-writeback.ts`、`generation-runtime.tsx`、`generation-status.tsx`
  - `packages/contracts/src/canvas.ts`
  - `apps/desktop/src/renderer/src/features/projects/canvas/project-canvas.tsx`

## 规格

- **宿主接口**：`CanvasGenerationModel` 改为 `{ id, label, kind: 'image'|'video'|'tts', capability: Capability（已用 effectiveCapability 裁剪）, protocol: ProtocolDescriptor, transport: Record<MediaKind,'inline'|'url'> }`。删除 `profile`、`upload`。`create(request: SemanticRequest)`。宿主从 `GET /models` 过滤出已启用、`blockedReason` 为空的媒体模型，默认模型排在最前。`storageReady` 保留。
- **画布数据**：
  - `packages/contracts/src/canvas.ts` 中，`CanvasMediaData.mode` 改为 `VideoModeId`；`mediaReferences[].role` 改为 `InputRole`；`params` 与 `pendingParams` 的键限定为语义参数键；新增 `extras?: Record<string, Value>`；删除 `CanvasVideoMode`。
  - 图片、视频节点类型版本加 1。`migrate` 规则：
    - 旧 `mode` 映射：`text` → `t2v`，`frames` → 有尾帧连线时 `first_last`，否则 `first`；`reference` → `reference`。
    - 旧参数键映射：`ratio`、`aspect_ratio` → `aspectRatio`，`seconds` → `duration`，`resolution` 保持不变，`generate_audio`、`sound` → `audio`，其余保留同名语义键。
    - 无法识别的键丢弃。
  - 加载节点后，若 `pendingJobIds` 中的任务查询返回 404，从节点中移除，按已结束处理。
- **参数面板**：参数控件抽到 `packages/canvas/src/nodes/params/`，统一接收 `{ capability, protocol, mode?, inputs, params, onChange, disabled, readOnly? }`，并从 `@frame-loom/canvas` 导出只读预览入口 `CapabilityPreview`，供 04 的设置页使用。
  - **图像**：
    - 档位分段：只显示启用的档位。
    - 比例网格：只显示当前档位已勾选的比例。选中时显示像素，由 `resolveImageSize` 计算；`provider` 规则显示「由服务商决定」。
    - 能力卡允许自定义尺寸时，出现宽高输入框，并实时显示对齐后的结果或错误。
    - 质量滑块：只停在支持的取值上。
    - 透明背景开关、输出格式、seed、负向提示词按能力卡显示。
    - 生成数量为 1 到 `count.max`，未设上限时为 1–4，沿用现有拆分方式。
  - **视频**：
    - 方式标签：由 `capability.modes` 生成，沿用悬停或选中时显示的规则。
    - 参数卡片「比例 · 时长」：比例、时长（范围用滑块，固定值用按钮，交给模型时显示「自动」）、分辨率、声音、水印、seed。
    - 可选值来自 `effectiveVideoParams`。被规则锁定的项置灰，并通过 Tooltip 和 `aria-describedby` 说明原因。
    - 声音为固定有声或固定无声时显示只读文字，不提供开关。
  - **附加参数**：放在「更多参数」折叠区，按 `ExtraParam` 类型渲染控件，值写入节点的 `extras`。
- **视频端口与素材**：`videoInputs(data, capability)` 按当前方式生成端口：
  - `first`：`first_frame`，最多 1 个。
  - `last`：`last_frame`，最多 1 个。
  - `first_last`：首帧、尾帧各最多 1 个。
  - `keyframes`：`keyframe`，最多 `keyframes.max`，未设上限时为 7。
  - `reference`：`reference`，可接受类型取 `reference.accept`，数量上限取 `totalCount`，未设时为 50。
  - `edit` 与 `extend`：本子计划先隐藏，由 07 实现。
  - 当前方式勾选了 `withReference` 或 `withFrames` 时，额外开放 `reference` 端口。
  - 切换方式时保留连线，与当前方式不兼容的端口仍然可见，但禁用并阻止提交（沿用现有规则）。
  - 素材选择弹层和本地素材入口按 `references` 限制过滤和计数，使用 `checkMedia` 检查元数据。
- **提示词引用**：`@{nodeId}` 的解析和插入保持不变。提交时由 engine 适配器按 `promptRef` 改写，画布不再自行替换为「图1」；composer 中的预览文本可以调用 `resolvePromptReferences` 显示。
- **提交**：`generation-panel.tsx` 组装 `SemanticRequest`：`inputs` 的 role、kind、order 与连线、`mediaReferences` 的顺序一致，`params`、`extras` 按上文规则填写。提交前调用 `checkRequest` 与 `checkMedia`，问题就地显示并阻止提交。按 transport 判断是否需要对象存储：任一素材类型解析为 `url` 且 `storageReady` 为 false 时，显示提示并阻止提交。
- **模型切换**：保留提示词、素材和连线。与新能力卡兼容的参数保留，不兼容的进入 `pendingParams` 并阻止提交，用户重新选择或清除后才解除；`extras` 只保留新模型声明过的键。
- **图片编辑工具**：`image-edit-tools.tsx` 与 `emotion-workspace.tsx` 的可用性改为调用 `imageEditSupport(capability, protocol)`。删除 contracts 中的 `ImageEditCapabilities`、`imageEditCapabilityIssue` 和 engine 中对应的检查调用，改用 `imageEditSupport`。engine 的表情后处理逻辑保留，只改能力来源。
- **删除**：
  - contracts：`generation.ts` 中的 `ModelProfile`、`GenerationRequest`、`checkGenerationRequest`、旧协议枚举；`generation-capabilities.ts`；`image-params.ts` 中按协议分支的 `imageRequestSize`（`IMAGE_*` 常量和标签可移入 `capabilities.ts` 或保留后改名）；`image-references.ts`；`models.ts`；`service-routing.ts`；`model-catalog.ts`。`GenerationStatus`、`GenerationErrorCategory`、`MediaFile`、`GenerationJob` 移到 `generation-job.ts` 保留，`GenerationJob.request` 改为 `SemanticRequest`，并删除 `profileId`、`channelModelId`，新增 `modelId`。
  - canvas：`nodes/media.ts` 中的 `VIDEO_MODES` 与写死的端口；`generation-params.tsx` 中的 `groups` 和视频键名单。

## 步骤

- [ ] T1 修改 contracts 的画布数据契约，迁移 `GenerationJob` 并删除旧契约文件；修复全仓类型错误，engine 端同步 — 验证：`pnpm run typecheck`
- [ ] T2 修改宿主接口与 `project-canvas.tsx` 的加载逻辑 — 验证：`project-canvas.test.tsx` 覆盖只加载已启用且无阻塞原因的媒体模型、默认模型排第一、TTS 模型传给画布（为 06 预留）
- [ ] T3 实现节点 `migrate` 与 404 清理 — 验证：canvas 单测覆盖旧模式与旧参数键映射、未知键丢弃、类型版本加 1、404 时移除 `pendingJobIds`，并覆盖 `document-file.ts`、`clipboard.ts` 的迁移路径
- [ ] T4 实现 `nodes/params/` 下的图像参数控件和 `CapabilityPreview` — 验证：组件测试覆盖关闭档位后按钮消失、取消勾选比例后网格项消失、像素来自 `resolveImageSize`、`provider` 文案、自定义宽高越界报错、质量只停在支持值、生成数量上限
- [ ] T5 实现视频方式标签、端口、参数卡片和素材限制 — 验证：组件测试覆盖以下内容：
  - 只列勾选的方式；首尾帧显示两个槽位。
  - Kling 型能力卡（`withReference: true`）在首帧方式下出现参考端口；Seedance 型不出现。
  - 规则锁定：Seedance 首尾帧时比例置灰且说明原因；MiniMax 文生时 adaptive 置灰。
  - 固定声音显示只读文字。
  - 参考素材类型与数量上限、总时长超限提示。
  - 切换方式后连线保留，不兼容端口禁用。
- [ ] T6 实现附加参数「更多参数」、`SemanticRequest` 组装、提交前校验、模型切换时的 `pendingParams` — 验证：`generation-panel.test.tsx` 改写后覆盖请求体中的 role、order、params、extras；校验问题阻止提交；需要对象存储时阻止提交；模型切换保留兼容值、不兼容值进入 `pendingParams`、`extras` 被过滤；每张图独立任务的数量
- [ ] T7 图片编辑能力来源改为 `imageEditSupport`，同步 engine 调用 — 验证：`image-edit-tools.test.tsx`、`image-edit-parameters.test.ts`、engine 的 `image-emotion.test.ts` 通过；不支持蒙版或参考图不足时禁用并说明原因
- [ ] T8 E2E：重写 `generation-image.test.ts`，并改写 `image-node-acceptance.test.ts`、`image-edit-runtime.test.ts`、`canvas-nodes.test.ts` 中依赖模型与生成的部分（`canvas-nodes.test.ts` 中与生成无关的用例不改）。模拟上游提供 `openai-images` 与 `ark-seedance`，经设置接口或 engine HTTP 直接创建渠道和模型 — 验证：E2E 覆盖以下流程：
  - 图片节点选模型 → 档位与比例 → 生成 → 写回版本。
  - 参考图 @ 引用 → 请求体中为 `图1`。
  - 视频节点文生 → 首尾帧，并验证比例锁定提示 → 生成 → 写回。
  - 切换模型时的 `pendingParams` 阻塞。
  - 角度编辑提交。
  - 截取明暗两种主题下的视频参数卡片截图并人工查看。
  - 命令：`pnpm --filter @frame-loom/desktop test:e2e -- generation-image image-node-acceptance image-edit-runtime canvas-nodes`
- [ ] T9 接入 04 的画布参数预览：`capability-tab.tsx` 改用 `CapabilityPreview`，补跑 04 的 T6 组件测试 — 验证：`pnpm --filter @frame-loom/desktop test`
- [ ] T10 扫描残留 — 验证：`rg -n "ModelProfile|profileId|CanvasVideoMode|VIDEO_MODES|executableGenerationModes|generationRoleReason|imageRequestSize|imageEditCapabilityIssue|'frames'|aspect_ratio" packages apps/desktop/src` 结果中只允许出现在适配器之外的注释和迁移映射表里，逐条确认后在「发现与偏差」记录；运行 `pnpm --filter @frame-loom/canvas test`

## 验证

- 预期：canvas、desktop、contracts、engine 单测通过；限定的 4 个 E2E 通过；截图经人工查看；残留扫描已确认。
- 实际：未执行。

## 进度

- 2026-10-28：创建子计划草稿。

## 发现与偏差

无。

## 交接

尚未开始。完成后，06 可复用 `nodes/params/` 与宿主 TTS 模型；07 在视频端口上增加 `base_video`。
