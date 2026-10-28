# Plan: 画布音频节点

Status: draft
Parent: plan.md

## 目标

画布新增 `audio` 节点（TTS 生成），满足以下几点：

- 输入框按 TTS 能力卡渲染文本、音色、风格与输出参数，生成后写回版本历史并可播放。
- 输出端口 `audio` 可以连到视频节点的参考音频端口。
- 不支持导入本地音频文件（笔记 D7）。

## 前置条件

- 03、05 已完成：TTS 协议可用，`nodes/params/` 与宿主模型列表中已包含 TTS。
- 阅读 `packages/canvas/src/registry/registry.ts`（`defineNodeType` 与端口类型 `audio` 已存在）、`nodes/builtin.tsx`、`nodes/media.ts`、`generation-writeback.ts`、`generation-runtime.tsx`、`views.tsx`，以及 `packages/contracts/src/canvas.ts` 的 `CANVAS_BUILTIN_DATA`、`TAGGABLE_NODE_TYPES`。
- 阅读 `apps/desktop/src/renderer/src/features/model-services/voice-picker.tsx`（04 已改造）和 engine 的音色接口（02、03）。
- 类型色使用现有 token `--canvas-type-audio`。

## 规格

- **数据**：
  - 音频节点复用 `CanvasMediaData`，`prompt` 存放待合成文本，不使用 `mode`。
  - 在 `CANVAS_BUILTIN_DATA` 中登记 `audio: CanvasMediaData`。
  - `TAGGABLE_NODE_TYPES` 增加 `audio`。
  - engine 的 `documentReferences` 已在 02 中按通用媒体数据解析，这里补测试。
- **节点定义**：
  - `type: 'audio'`，`label: '音频'`，`category: 'media'`，lucide 图标 `AudioLines`。
  - 默认尺寸 320×160，不保持宽高比。
  - 输入端口为空，输出端口为 `{ id:'out', label:'音频', dataType:'audio' }`。
  - `output(data)` 返回当前版本的 sha256。
- **视图**：
  - 节点体显示当前版本的波形占位、时长和播放按钮，使用原生 `<audio>`，地址取自 `host.media.url`，并遵守现有 CSP 对 `media-src` 的约束。
  - 版本切换沿用图片与视频节点的组件。
  - 生成中和失败状态沿用 `generation-status.tsx`。
- **输入框**：
  - 位置与尺寸沿用固定的下方输入框（620px），模型下拉只列 TTS 模型。
  - 文本框有字数计数，上限取 `maxChars`。
  - 音色选择器：
    - 选项合并预置音色、已保存的手填音色和远端拉取的音色。
    - 「从接口拉取」只在 `voices.sources` 含 `remote` 且协议声明 `voices` 操作时显示。
    - 「手填 ID」只在含 `manual` 时显示。
    - 宿主新增 `voices(modelId)`、`fetchVoices(modelId)`、`saveVoice(modelId, voice)` 三个方法，调用 02 的接口。
  - 指令文本：仅当 `instructions` 为 true 时显示。
  - 语速、音调、音量滑块：按能力卡中配置的范围显示，未配置的不显示。
  - 输出格式与采样率下拉。
  - 「更多参数」中显示附加参数。
- **提交**：
  - 提交 `SemanticRequest`：`prompt` 为文本，`params` 包含 `voice`、`instructions`、`speed`、`pitch`、`volume`、`format`、`sampleRate`，`inputs` 为空。
  - 提交前调用 `checkRequest`。
  - 每次提交只生成 1 个任务。
- **写回**：复用 `writeGenerationJob`，追加的版本带 `durationMs`、`sampleRate`、`channels`、`codec`，元数据来自 ffprobe。
- **与视频连接**：音频节点的 `out` 可以连到视频节点的参考端口，前提是该端口的 `accepts` 包含 `audio`，也就是能力卡的 `reference.accept` 包含 `audio`。连接后，参考素材总时长参与 `checkMedia` 检查，使用的是版本中的 `durationMs`。
- **添加菜单**：在添加菜单的媒体分组中加入「音频」。

## 步骤

- [ ] T1 修改 contracts 画布契约，登记 `audio`；engine `project-media.service.ts` 补充音频节点引用的测试 — 验证：`pnpm --filter @frame-loom/contracts test`、`pnpm --filter @frame-loom/engine test -- project`
- [ ] T2 实现节点定义、视图、播放与版本切换，并注册到 `createBuiltinRegistry` — 验证：组件测试覆盖创建节点、无版本时的空状态、播放控件、版本切换、标签可用
- [ ] T3 实现 TTS 输入框与音色选择，扩展宿主接口，在 `project-canvas.tsx` 中实现音色相关的三个方法 — 验证：组件测试覆盖：
  - 能力卡驱动显隐：指令文本、三个滑块、拉取与手填入口。
  - 字数上限阻止提交。
  - 远端拉取失败时保留手填。
  - 提交的请求体。
- [ ] T4 实现写回与音频到视频参考的连接 — 验证：单测覆盖写回后的版本元数据；连接只在视频参考接受音频时被允许；参考音频总时长超限时视频节点阻止提交
- [ ] T5 编写 E2E `apps/desktop/e2e/canvas-audio.test.ts`，替代 `tts-audio.test.ts`，后者删除。模拟上游提供 `gemini-generate` TTS（返回 base64 PCM）与 `ark-seedance` — 验证：
  - E2E 覆盖：添加音频节点、选模型与音色、生成、写回、播放（检查 `<audio>` 的 `duration` 大于 0）、连到视频节点参考端口、视频提交的请求体中出现 `reference_audio`、重启后版本仍在。
  - 截取明暗两种主题下的音频节点截图并人工查看。
  - 命令：`pnpm --filter @frame-loom/desktop test:e2e -- canvas-audio`

## 验证

- 预期：contracts、engine、canvas、desktop 中受影响的单测通过；`canvas-audio` E2E 通过；截图经人工查看；`rg -n "tts-audio" apps/desktop/e2e` 结果为空。
- 实际：未执行。

## 进度

- 2026-10-28：创建子计划草稿。

## 发现与偏差

无。

## 交接

尚未开始。
