# Agent Note: 画布图片节点：统一生图参数、按模型能力动态化与提示词输入框

Status: proposed

## Problem

[无限画布](../../implemented/feature/2026-10-25-infinite-canvas.md)已能在图片节点内选模型、填档案参数并生成，但参数层与交互层都不足以支撑日常创作：

- **参数是供应商原始字段。** `apps/engine/src/modules/generation/profiles/image-profiles.ts` 按协议直接透传：OpenAI 只有三个固定 `size` 与 `quality`；Gemini 只有五个 `aspectRatio`、没有 `imageSize`；Seedream 只有 `2K/4K` 与水印。用户在不同模型间看到的是 `1024x1536`、`16:9`、`2K` 三种互不相通的概念。
- **档案粒度是协议，不是模型族。** 同一协议下 gpt-image-1 与 gpt-image-2、gemini-2.5-flash 与 gemini-3-pro 共用一份能力，无法表达"gpt-image-1 只有三个尺寸、gpt-image-2 支持任意比例""Seedream 4.5 没有 1K"等差异。`matchIds` 精确匹配，带日期快照的 id（如 `gpt-image-2-2026-04-21`）会落到通用档案。
- **切换模型丢失选择。** `packages/canvas/src/nodes/generation-panel.tsx` 切换模型时写入 `params: {}`。
- **一次只能出一张。** 节点只有一个 `pendingJobId`，`packages/canvas/src/nodes/generation-writeback.ts` 只写回第一张产物。
- **交互是表单。** 原生下拉框和复选框堆在节点卡片底部，没有比例图示、参数摘要，也不能在提示词里指明"哪张参考图做什么"。
- **产物 mime。** 改造前 `apps/engine/src/modules/generation/adapters/image-response.ts` 把产物统一声明为 `image/png`，Seedream 实际返回 jpeg；入库时 `MediaService` 已按文件头重新识别，但适配器层仍需修正声明，避免透明背景等依赖格式的判断出错。

用户要求：

- 图片节点参数统一为比例（1:1、16:9、9:16、3:4、4:3、3:2、2:3、5:4、4:5、21:9、2:1、1:2、3:1、1:3）、清晰度（1K／2K／4K）、画质（低／中／高／超高／极致）、背景（自适应／透明／不透明），按所选模型的能力动态调整。
- 模型由用户在模型服务里自行配置；项目负责识别用户配置的模型并给出能力，不决定"接入哪些模型"。官方已存在的模型族（含 gpt-image-2.5）必须有能力档案，配不配由用户决定。
- 节点与输入框的 UI/UX 对齐 `docs/design/canvas-image-node.html`（仅图片节点与输入框；其余公共元素保持现状）。
- 本期实现 @ 引用参考。
- 视频节点只复用输入框外壳，参数能力下一轮单独调研。

失败条件：用户能在界面上选出某模型不支持的参数组合并提交；切换模型后参数静默变化而无提示；同一节点多张生成互相覆盖或丢失；@ 引用与实际发送的参考图编号不一致。

## Proposal

### 已落地边界

01 的共享契约、02 的 engine 档案与适配器、03 的画布数据与多任务运行时已落地；新界面和 @ 引用仍待后续子计划。engine 提供 8 个模型族与 3 个通用档案，图片统一入口 `mediaProfile()` 复用 `imageProfile()` 的最长前缀匹配，桌面宿主加载图片档案时使用相同匹配规则，视频与 TTS 保持精确匹配。原有三个 `*-default` ID 分别保留为 GPT Image 1、Gemini 2.5 Flash Image、Seedream 4.0，已保存的显式选择仍优先，不自动升档。

任务提交通过 `AdapterContext.profile` 传递创建时保存的档案快照，避免显式通用档案在执行时按模型 ID 重新匹配成更高能力。三个图片适配器先按档案解析语义参数，再显式组装供应商字段；OpenAI generations／edits 共享尺寸、画质与背景映射，透明时指定 PNG；Gemini 仅对声明清晰度的档案发送 `imageSize`；Seedream 发送像素尺寸和水印，产物声明 JPEG。`MediaService` 已有图片文件头及 `image-size` 识别，图片不经过 `probeMedia`，本次保留该实现并以 JPEG 下载入库集成测试确认真实格式。

### 调研依据

2026-10-26 的调研事实，上游可能变化，冒烟结果原地修正本节。

- **OpenAI 图片**（[API 参考](https://developers.openai.com/api/reference/python/resources/images/methods/generate/)、[openai-python 参数定义](https://github.com/openai/openai-python/blob/main/src/openai/types/image_generate_params.py)、[提示与尺寸指南](https://developers.openai.com/cookbook/examples/multimodal/image-gen-models-prompting-guide)、[生成指南](https://developers.openai.com/api/docs/guides/image-generation)）：
  - gpt-image-1／1-mini／1.5、chatgpt-image-latest：`size` 为 `1024x1024`、`1536x1024`、`1024x1536`、`auto`；`quality` 为 `low/medium/high/auto`；`background` 为 `auto/opaque/transparent`。
  - gpt-image-2（含 `-2026-04-21` 快照）与 gpt-image-2.5（sunburst、flare 及 `-2026-09-08` 快照）：`size` 任意 `WxH`，宽高为 16 的倍数，长短边比 ≤ 3:1，长边 ≤ 3840，总像素 655,360–8,294,400；超过 2560×1440 为实验性。gpt-image-2.5 额外支持 `quality: xhigh/max`。
  - 透明背景要求 `output_format` 为 `png` 或 `webp`；gpt-image-2 的透明为预览（API 参考旧文本称不支持，SDK 与指南称预览可用）。
  - `n` 为 1–10；GPT 图片模型始终返回 base64。
- **Gemini**（[生图文档](https://ai.google.dev/gemini-api/docs/image-generation)、[Gemini 3 指南](https://ai.google.dev/gemini-api/docs/generate-content/gemini-3)）：`generationConfig.imageConfig.aspectRatio` 与 `imageSize`。10 个标准比例 1:1、2:3、3:2、3:4、4:3、4:5、5:4、9:16、16:9、21:9；3.1 Flash Image 另有 1:4、4:1、1:8、8:1。`imageSize` 为 `1K/2K/4K`，必须大写 K；3.1 Flash 另有 512 档，官方与第三方写法不一致。2.5 Flash Image 固定约 1K。无画质、背景字段。
- **Seedream**（[火山方舟生图 API](https://ark.volcengine.com/region:cn-beijing/docs/image-generation-api)）：`size` 二选一，档位（4.0 为 `1K/2K/4K`，4.5 为 `2K/4K`，比例靠提示词描述）或 `WxH` 像素。像素方式总像素 4.0 为 [921,600, 16,777,216]，4.5 为 [3,686,400, 16,777,216]，宽高比 [1/16, 16]。官方给出 1K／2K／4K × 1:1、4:3、3:4、16:9、9:16、3:2、2:3、21:9 的像素表。无画质、透明背景字段；输出 jpeg。Seedream 5.0 的参数仅见第三方文档。
- **参考项目**（本机 `D:\WorkSpace\project\personal\reference_projects`，只读）：
  - infinite-canvas：节点只存一个 `size` 串，清晰度与比例从中反推；`web/src/lib/media-size.ts` 有 1k/2k/4k × 9 比例像素表，`web/src/services/api/image.ts` 按 gpt-image 约束校验并为 Gemini 取最接近比例；多张生成每张单独请求、单独状态、可单张重试。无按模型能力声明。
  - OpenTV：`lib/ai/model-registry.ts` 为视频模型集中声明能力，`resolveVideoAspectRatio(model, current)` 当前值合法即保留否则回退；生图只有三种比例，像素换算交给网关。
  - huobao-canvas：`apps/web/src/config/providers/*.js` 每个模型一份字段 schema，参数面板随模型变化，主栏加"更多"两层；参数键随模型变化，切换模型整体重置，OpenAI 未声明 background。

### 统一参数

节点 `data.params` 只存语义键，取值与供应商无关：

| 键 | 取值 | 界面 |
| --- | --- | --- |
| `aspectRatio` | `1:1` `16:9` `9:16` `3:4` `4:3` `3:2` `2:3` `5:4` `4:5` `21:9` `2:1` `1:2` `3:1` `1:3` | 比例 |
| `resolution` | `1K` `2K` `4K` | 清晰度 |
| `quality` | `low` `medium` `high` `xhigh` `max` | 画质：低／中／高／超高／极致 |
| `background` | `auto` `transparent` `opaque` | 背景：自适应／透明／不透明 |

- 默认值 `1:1 · 2K · 中 · 自适应`；不提供"自动"画质档。档案不支持的键不出现。
- 数量另存 `data.count`（1–4，默认 1），不进入请求 `params`。
- 水印等供应商特有参数继续作为档案参数存在，在参数面板"更多"里显示，键名保持原样。

### 档案：按模型族划分、前缀匹配

- 继续使用 `packages/contracts/src/generation.ts` 的 `ModelProfile.params`（enum 白名单）与 `constraints`，`checkGenerationRequest` 原样复用。
- `params` 增加可选 `notes: Record<string, string>`，为个别取值附标签（如 4K 的"实验"、透明的"预览"），不参与校验。
- 档案匹配由 `matchIds` 精确匹配改为前缀匹配，多条命中取最长前缀；`profileId` 显式指定时优先，保留现有逻辑。`packages/contracts` 中 `ModelProfile` 的 `matchIds` 语义随之改为"上游 ID 或其前缀"，`apps/engine/src/modules/generation/profiles/image-profiles.ts` 的 `imageProfile()` 同步。
- 内置图片档案：

| 档案 | 前缀 | 比例 | 清晰度 | 画质 | 背景 |
| --- | --- | --- | --- | --- | --- |
| OpenAI GPT Image 1 | `gpt-image-1`、`chatgpt-image` | 1:1、3:2、2:3 | 不提供 | 低／中／高 | 3 种 |
| OpenAI GPT Image 2 | `gpt-image-2` | 14 种 | 1K／2K／4K（4K 标"实验"） | 低／中／高 | 3 种（透明标"预览"） |
| OpenAI GPT Image 2.5 | `gpt-image-2.5` | 14 种 | 1K／2K／4K（4K 标"实验"） | 5 档 | 3 种 |
| Gemini 2.5 Flash Image | `gemini-2.5-flash-image` | 10 种标准 | 不提供 | 不提供 | 不提供 |
| Gemini 3 Pro Image | `gemini-3-pro-image` | 10 种标准 | 1K／2K／4K | 不提供 | 不提供 |
| Gemini 3.1 Flash Image | `gemini-3.1-flash-image` | 10 种标准 | 1K／2K／4K | 不提供 | 不提供 |
| Seedream 4.0 | `doubao-seedream-4-0` | 14 种 | 1K／2K／4K | 不提供 | 不提供 |
| Seedream 4.5 | `doubao-seedream-4-5` | 14 种 | 2K／4K | 不提供 | 不提供 |

- 通用档案（匹配不上时使用）取保守能力：通用 OpenAI 为 GPT Image 1 档案的能力；通用 Gemini 只有 10 种比例、不发 `imageSize`；通用 Seedream 为 2K／4K 加 14 种比例。
- Gemini 3.1 的 512 档与 1:4、8:1 等极端比例、Seedream 5.0 暂不内置：前者写法未经官方确认、极端比例在 5 列网格中无法清晰表达，后者只有第三方文档。用户配置的这类模型落到通用档案仍可生成；官方确认后加档案即可。

### 尺寸换算：contracts 中的共享纯函数

01 契约、02 engine 与 03 画布参数回退已落地；尺寸预览与 @ 引用界面接入仍为本篇提案。共享入口使用 `imageRequestSize(profile, params)`、`resolveImageParams(profile, current)`、`parseImageReferences(prompt)` 与 `resolveImagePrompt(prompt, inputNodeIds)`。引用函数接收与实际 `inputs` 一一对应的已排序源节点 id，不直接读取画布连线或 `inputOrder`（后者存的是边 id）。失效引用保留原标记并返回 `missingNodeIds`，调用方据此阻止提交。

尺寸换算按档案能力区分版本，不再维护第二份模型 id 匹配：OpenAI 是否声明 `resolution` 区分固定尺寸与任意尺寸；Seedream 是否允许 `1K` 区分 4.0 与 4.5／通用档案的面积下限。入参先按同一档案回退，未提供参数使用档案默认值；非图片档案拒绝换算，Gemini 返回 `undefined`。`changes` 记录显式传入值的调整／移除（含中文文案），首次填充默认值不产生模型切换提示。数量属于节点 `data.count`，不进入此函数，由 03／04 处理。

`packages/contracts` 新增 `imageRequestSize(profile, params)` 一类纯函数，engine 适配器用它组装请求，界面用它显示"≈ W×H"，两边结果一致。

- **GPT Image 1**：查表，1:1 → `1024x1024`，3:2 → `1536x1024`，2:3 → `1024x1536`。
- **GPT Image 2／2.5**：目标面积 A 为 1K = 1024²、2K = 2560×1440（官方可靠上限）、4K = 8,294,400（总像素上限）。`w = √(A·r)`、`h = √(A/r)`，长边超过 3840 时等比缩到 3840，各自取最接近的 16 的倍数；越过面积上限时改为向下取整，低于下限时向上取整；取整后长短边比超过 3 时把长边向下调到满足 3:1 的 16 倍数。示例：

  | 比例 | 1K | 2K | 4K |
  | --- | --- | --- | --- |
  | 1:1 | 1024×1024 | 1920×1920 | 2880×2880 |
  | 16:9 | 1360×768 | 2560×1440 | 3840×2160 |
  | 21:9 | 1568×672 | 2928×1264 | 3840×1648 |
  | 3:1 | 1776×592 | 3312×1104 | 3840×1280 |

  单测断言每个比例 × 档位都满足官方四条约束，并且实际比例与目标比例误差 < 1%。独立取整在 1K 的 5:4、4:5、2:1、1:2 上会略超 1%；仅在误差超限时检查宽高各 ±16 的邻近组合，取满足面积、长边、长短边比及误差约束且离取整前目标最近的一组。不扩大搜索范围，也不改变上表已满足约束的示例。
- **Gemini**：不换算，发 `imageConfig: { aspectRatio, imageSize }`；档案没有 `resolution` 时不发 `imageSize`。
- **Seedream**：一律发像素 `size`，不用"档位 + 提示词描述比例"（比例不可控）。官方表中的 8 个比例直接取表值（如 2K 16:9 = 2848×1600）；其余比例按档位面积 1024²／2048²／4096² 计算，16 对齐，再夹到对应版本的总像素范围（4.5 的 2K 至少 3,686,400）。
- 背景为透明时 OpenAI 适配器同时发送 `output_format: 'png'`。
- 适配器只把语义参数翻译成供应商字段，不再 `...request.params` 整体展开；档案未声明的键不会进入请求体。

### 切换模型时回退

`packages/contracts` 新增纯函数 `resolveImageParams(profile, current)`，返回 `{ params, changes }`：

- 比例：支持则保留，否则取对数距离最近的支持比例（21:9 → 16:9）。
- 清晰度：取不高于当前值的最高档；没有则取最低档。
- 画质：取序号最接近的档位。
- 背景：新档案不支持透明时改为自适应；整组不支持时移除。
- 数量：夹到 1–4。
- 档案未声明的键丢弃；旧节点中的 `size: '1024x1024'` 等原始参数在此自然清除，不另写迁移。
- `changes` 非空时画布提示"已按新模型调整：21:9 → 16:9"。

### 多张生成：N 个任务

03 已落地：成功与取消任务移出 `pendingJobIds`，失败任务保留引用供重启恢复和单张重试，主动放弃失败项则移除引用；失败任务不反复通知，重试通过宿主 `resubmit` 返回新任务后在当前文档与历史快照中替换原 id。连续创建中每次立即登记成功创建的任务，后续创建失败停止本轮并保留已创建项。节点迁移同时覆盖持久化加载、JSON 导入与剪贴板入口，未来版本不降级迁移。现有表单暂以原有组件提供数量与逐项重试入口，04 接管最终外观。模拟供应商桌面 e2e 验证三张生成、第二张失败后单张重试、三版本与首帧视频重启保留。

- 数量 ×N 时画布连续提交 N 个独立任务，各自成功后追加一个版本；失败的任务在节点上单独显示并可单独重试（复用 `POST /generation-jobs/:id/resubmit`）。
- 理由：Gemini 与 Seedream 每次请求只返回一张，N 个任务对所有协议一致；每张有独立状态、取消与计费提示。代价：档案并发上限为 1 时多张排队；一次生成写入多个任务记录。
- `CanvasMediaData.pendingJobId` 改为 `pendingJobIds: uuid[]`（最多 4）。旧文档在 `packages/canvas` 节点注册表的 `migrate` 中把 `pendingJobId` 转为单元素数组，`imageNode`／`videoNode` 的 `typeVersion` 升到 2；contracts 的 schema 在过渡期同时接受两个字段，engine 原样保存。
- `generation-runtime`、`generation-writeback`、删除确认（`use-actions.ts`）全部按数组处理；写回仍以 `version.jobId` 去重。

### @ 引用参考

- **触发**：在提示词中输入 `@`，或点击输入框头部的"+"，弹出参考列表。输入法组字（`isComposing`）期间不触发，也不响应画布快捷键。
- **候选**：第一组为已连入本节点的参考（缩略图、名称、当前编号）；第二组为画布上其他已有产物的图片节点。不列当前节点；`checkConnection` 判定成环或不兼容的置灰并说明原因；参考数已达当前档案上限时第二组整体置灰，提示"当前模型最多 N 张参考"。
- **选中未连线节点**：自动建立连线并插入标签，合并为一步撤销。
- **存储**：`prompt` 仍是字符串，引用写为 `@{nodeId}`（节点 id 字符集 `[A-Za-z0-9_-]`），不改 schema。
- **显示**：轻量 contentEditable 编辑器，只有纯文本与原子标签，粘贴清除格式，退格整块删除标签。标签显示缩略图与"图N"。
- **编号**：按 `inputOrder` 排列后的参考序号，即请求 `inputs` 中的位置。头部缩略图可拖动调整顺序，标签编号同步变化；同一节点多次引用编号相同。
- **失效**：引用的连线被删除时，标签显示为失效样式，发送按钮置灰并提示"引用的参考已断开"。
- **提交**：`@{nodeId}` 替换为"图N"或"Image N"。替换前的提示词含汉字（CJK 统一表意文字）用"图N"，否则用"Image N"；判断与替换由一个纯函数负责，编辑器预览与提交共用。连入但未引用的参考照常作为输入发送。字数按替换后文本计数。
- 视频节点复用编辑器组件，但视频提示词的引用语法（如"图片1／视频1"）随下一轮视频调研确定，本期不在视频节点开放 @。

### 节点与输入框界面

依据 `docs/design/canvas-image-node.html`；颜色全部使用主题 token，明暗两种模式验收；画布背景、工具栏、小地图保持现状。

- **节点本体**：左上图标加标题（复用 `NodeTitle`）；图片框圆角 6px，选中时边框加粗；空态为占位图标。选中且无版本时，上方显示胶囊按钮"上传图片"（复用现有媒体导入）。右侧居中圆形"+"按钮，打开现有"添加并连接"菜单。生成中在图片框上叠加转圈、"生成中 1/3"状态与"放弃任务"；提交结果不明保留计费提示。多版本时悬停显示"‹ 2/5 ›"切换，替代原生下拉框。
- **输入框**：替代现有 `GenerationPanel` 表单，用 xyflow `NodeToolbar` 挂在节点下方，仅选中单个节点时显示，屏幕尺寸固定不随画布缩放。约 620px 宽、16px 圆角、浮层阴影。
  - 头部：虚线"+"（打开 @ 列表）、已连入参考的缩略图条；右侧展开按钮，文本区在 80px 与 260px 之间过渡。
  - 文本区：@ 编辑器，占位"描述你想要生成的内容，输入 @ 引用参考内容"。
  - 辅助行：复制提示词、字数统计"0 / 32000"（上限随协议，MiniMax 视频 7000）。设计稿中含义不明的"T"图标不实现。
  - 底栏左：模型、参数摘要、数量，以竖线分隔。模型弹层每项显示名称、能力说明（如"1K–4K"）与勾选；不实现折扣标签。参数摘要形如"16:9 · 2K · 中 · 自适应"，档案不支持的组不出现。数量弹层 ×1–×4。
  - 底栏右：发送按钮；不可发送时置灰，Tooltip 写明原因（缺提示词、模型不可用、参考超限、引用失效、需要对象存储）。
- **参数面板**（约 420px）：比例 5 列网格并绘制比例形状；清晰度分段按钮；画质 5 档滑块加可点击标签；背景胶囊按钮；"更多"折叠区放供应商特有参数；底部小字"≈ 2560×1440"。整组不支持时隐藏该组；组内不支持的取值置灰，Tooltip"当前模型不支持"；带 `notes` 的取值显示角标（"实验""预览"）。
- **组件**：shadcn Popover、ToggleGroup、Tooltip，新增 shadcn Slider（`packages/ui`，基于已依赖的 `radix-ui`），图标使用 lucide。
- 低缩放裁剪规则不变：缩放低于 40% 时不挂载未选中节点的输入框。

### 相关笔记核对

- [无限画布](../../implemented/feature/2026-10-25-infinite-canvas.md)：部分重叠。该篇"节点内生成"的生成区形态、`pendingJobId` 单任务与"切换模型清空参数"由本篇替换；节点即生成位、结果追加为版本、任务同步挂在编辑器根部等决定不变。落地时原地同步该篇事实并互链。
- [模型管理](../../proposed/architecture/2026-10-24-model-management.md)：部分重叠。档案字段中 `matchIds` 由精确匹配改为前缀匹配；"不按名称关键词猜类别"不受影响（前缀只在用户已选定类别与协议后选择档案）。图片档案按模型族拆分的事实落地时原地同步。
- [以渠道为中心的模型设置](../../implemented/feature/2026-10-25-channel-centric-model-settings.md)：相关不重叠；设置页的档案下拉会出现新的档案名称，交互不变。
- [共享契约](../../implemented/architecture/2026-10-24-shared-contracts.md)：部分重叠，contracts 新增尺寸换算、参数回退与引用替换纯函数，约定不变。
- 其余笔记无关。

## Alternatives considered

- **节点直接存供应商原始参数（huobao-canvas 的做法）** — 最强理由：每个模型的取值原样可见，零换算，适配器只需透传，新增模型只写一份 schema。不选：参数键与取值格式随模型变化，切换模型无法保留用户选择；用户要求的比例、清晰度、画质、背景是跨模型概念，原始字段做不出统一面板。
- **只存一个 `size` 字符串，清晰度与比例从中反推（infinite-canvas 的做法）** — 最强理由：单字段，天然兼容自定义像素，OpenAI 可直接下发。不选：Gemini、Seedream 都按比例和档位建模，从像素反推会归入近似档位；面板的比例与清晰度是两个独立选择，存成一个字段需要反复解析。
- **能力声明放在 renderer（huobao-canvas 的做法）** — 最强理由：界面迭代不需要动 engine。不选：[模型管理](../../proposed/architecture/2026-10-24-model-management.md)已确定档案由 engine 发布、contracts 共享校验，engine 必须用同一份能力强制拦截非法请求；放在前端会出现两份能力数据。
- **新增独立的能力结构（如 `imageCapabilities: { aspectRatios, resolutions, ... }`）** — 最强理由：语义更直观，前端不必从 `params` 中按键名识别。不选：现有 `params` 白名单与 `constraints` 已能表达全部取值与组合限制，`checkGenerationRequest` 可直接复用；新增结构会让同一事实有两处来源。
- **切换模型时整体重置为默认值（huobao-canvas 的做法，也是现状）** — 最强理由：实现最简单，不可能残留非法值。不选：用户在模型间对比时需要保持比例与清晰度；就近回退加提示同样不会残留非法值。
- **OpenAI 多张使用原生 `n`、其他协议 N 个任务** — 最强理由：OpenAI 一次请求出多张，延迟更短、任务记录更少。不选：用户确定统一 N 个任务；两套路径会让状态、取消、单张重试与写回各写两份。
- **不支持的取值一律隐藏** — 最强理由：面板更干净，不会诱导用户点击。不选：用户确定组内置灰、整组隐藏；组内隐藏会让比例网格在切换模型时跳动，用户也看不出"这个模型不行"。
- **gpt-image-2 不开放透明背景，4K 不开放** — 最强理由：透明在官方文档中前后矛盾，4K 为实验性，开放后失败率可能偏高。不选：用户确定两者都开放，分别标"预览""实验"；上游拒绝时按现有 `invalid_params` 分类提示。
- **输入框常驻显示并随画布缩放（设计稿做法）** — 最强理由：与设计稿一致，多节点时一眼看到所有提示词。不选：缩小画布后文字不可读，多个输入框互相遮挡；用户同意只在选中单个节点时显示并固定屏幕尺寸。
- **Seedream 发档位串并在提示词中描述比例** — 最强理由：官方推荐方式之一，模型自行决定构图。不选：比例不可控，与界面上选中的比例不一致；像素方式完全遵守用户选择。
- **@ 编辑器使用 Tiptap 或 Lexical** — 最强理由：提及、撤销、粘贴、输入法处理都成熟。不选：需求只有纯文本加一种原子标签；引入后增加包体积与样式适配成本，现有画布快捷键与输入法放行规则也要再适配一遍。需要更多富文本能力时再升级。
- **@ 列表只列已连入的参考** — 最强理由：行为简单，不会在提示词编辑中改变图结构。不选：用户确定列出画布上其他图片节点，选中后自动连线，减少"先连线再引用"的往返。
- **引用固定替换为"图N"** — 最强理由：规则单一，测试简单。不选：用户确定跟随提示词语言，英文提示词中混入中文编号可能降低模型理解。
- **@ 引用放到第二期** — 最强理由：本期改动已覆盖 contracts、engine、画布三层，推迟可降低风险。不选：用户确定本期实现。

## Acceptance criteria

1. contracts 单测：
   - `imageRequestSize`：GPT Image 2／2.5 的 14 比例 × 3 档全部满足宽高 16 倍数、长边 ≤ 3840、长短边比 ≤ 3、总像素 655,360–8,294,400，且比例误差 < 1%；GPT Image 1 三个尺寸；Seedream 8 个官方比例等于官方表值，其余比例满足 4.0／4.5 的总像素与比例范围。
   - `resolveImageParams`：比例就近、清晰度降档、画质就近、透明回退、未知键丢弃、`changes` 内容。
   - 引用替换：中英判断、编号随 `inputOrder`、同节点多次引用编号一致、失效引用被检出。
   - `checkGenerationRequest` 拒绝档案未声明的取值（如 Seedream 4.5 的 1K）。
2. engine 单测与请求固件：
   - 前缀匹配取最长前缀（`gpt-image-2.5-flare-2026-09-08` 命中 2.5、`gpt-image-2-2026-04-21` 命中 2）、`profileId` 优先、无匹配时落通用档案。
   - 三个适配器的请求体：OpenAI `size/quality/background/output_format`，Gemini `imageConfig`（无 `resolution` 时不发 `imageSize`），Seedream 像素 `size` 与 `watermark`；档案外的键不进入请求体。
   - 产物 mime 与实际格式一致（Seedream jpeg）。
3. 画布单测与组件测试：`pendingJobIds` 迁移与多任务写回、去重；切换模型回退与提示；面板置灰／隐藏随档案变化；发送按钮禁用原因；@ 选中未连线节点建线并一步撤销；输入法组字不触发菜单。
4. 桌面 e2e（模拟供应商）：×3 生成写回 3 个版本并可单张重试失败项；切换模型后参数按回退规则变化；@ 引用后提交的提示词与 `inputs` 编号一致；旧文档（含 `pendingJobId`）打开后任务继续补写。
5. 人工验收（开发版与加固 exe，明暗模式）：节点与输入框对照 `docs/design/canvas-image-node.html`；720×560 最小窗口下输入框与参数面板不溢出；键盘可操作全部弹层；中文输入法在 @ 编辑器内正常组字。
6. `pnpm test`、`pnpm typecheck`、`pnpm lint`、`pnpm format:check`、`pnpm run verify` 通过。

## Risks

- **上游能力漂移**：gpt-image-2 透明背景、4K 与 Gemini 3.1 512 档来自文档且存在矛盾或预览标注；档案取值以真实供应商冒烟结果原地修正，冒烟归[模型管理](../../proposed/architecture/2026-10-24-model-management.md)的验收持有。
- **中转站差异**：用户经 new-api 等中转配置的模型可能不接受任意 `WxH` 或 `imageConfig.imageSize`；此时用户可在模型设置中改选通用档案，错误按 `invalid_params` 提示。
- **前缀误匹配**：前缀匹配可能把未来同前缀但能力不同的模型（如假设的 `gpt-image-2-mini`）归入 gpt-image-2；最长前缀与显式 `profileId` 可纠正，新模型出现时补档案。
- **落盘格式**：`pendingJobIds` 与 `typeVersion` 2 一旦分发，旧版本应用打开新文档会把图片／视频节点降级为未知节点占位（数据保留）；回退时需要反向迁移。
- **contentEditable 边界**：粘贴、撤销、输入法与选区在 Chromium 中有细节差异；以组件测试与人工输入法验收兜底，问题集中时再评估富文本库。
- **成本**：N 个任务在并发上限为 1 时排队，4 张 4K 可能耗时数分钟；节点上显示进度"1/4"。
- **回滚**：契约、档案、适配器、画布各自独立提交；节点迁移与 `pendingJobIds` 回退需要反向迁移函数。
