# Agent Note: 画布图片节点转 720° 全景图

Status: implemented

## Problem

AI 漫剧要在同一场景里连续出多个镜头。只有一张平面场景图时，换机位、正反打、人物走位后，模型会重新猜测门窗朝向、陈设和光源，场景前后不一致。2026 年主流 AI 漫剧／短剧工具已把「单图转 720° 全景」作为标准能力：LibTV 的图片节点和导演台提供一键转全景，并可在导演台预览全景（[优设网](https://www.uisdc.com/hangye/libtv-director)、[腾讯网](https://view.inews.qq.com/a/20260602A033B300)）；爱奇艺纳逗 Pro 的图片节点有「720° 全景生成」（[纳逗 Pro 文档](https://nadoupro.iqiyi.com/docs/canvas-guide)）；小云雀短剧 Agent 2.0、橙星梦工厂、天工短剧工作台都把全景用于在同一空间里转向取景（[大国 AI](https://daguoai.com/4833.html)、[IT 之家](https://www.ithome.com/0/988/212.htm)、[CB 科技站](https://www.cbish.com/keji/52397.html)）。

Frame Loom 的图片节点已有多角度、重打光和表情编辑（[图片编辑工具](../../implemented/feature/2026-10-28-canvas-image-edit-tools.md)），但没有全景生成、全景查看，也不能从全景里截取镜头视角。多角度编辑只改提示词里的机位，每次都重新生成，不能保证同一空间。

约束：产品只接第三方 API，不运行本地模型（见[模型服务配置层重构](../../implemented/architecture/2026-10-28-model-service-rebuild.md)）；能力来源是用户能力卡与协议上限；编辑结果绝不覆盖源节点；已提交任务冻结源图快照。

## 技术原理调研（2026-10-29）

### 720° 与等距柱状投影

「720°」是国内产品的叫法，指水平 360° 加垂直 180°（可看天顶和地面）的完整球面全景。行业统一的存储格式是等距柱状投影（ERP，equirectangular）：横轴对应经度 −180°～180°，纵轴对应纬度 90°～−90°，因此宽高比固定为 2:1。ERP 有两个拓扑约束：左右边缘是同一条经线，必须连续；顶行与底行各自收缩为一个极点，所以越靠近上下边缘横向拉伸越大（[SpheRoPE](https://orhir.github.io/SpheRoPE/) 把它们概括为水平周期性和极点汇聚）。查看器把 ERP 贴到相机所在球体的内壁上，拖动改变视线方向；截取视角就是用透视相机重新投影出一张普通图片。

### 单图生成全景的三类做法

1. **通用图像编辑模型加提示词**：把源图作为参考，要求模型输出 2:1 ERP 全景，补全四周、天空／天花板和地面，并让左右边缘衔接。BeefTV 的画布全景和导演台 AI 全景都用这种做法，固定提示词要求 2:1、左右无缝、无拼贴、无边框、无文字和拍摄设备（本地源码 `web/src/components/canvas/canvas-panorama-config-modal.tsx`、`web/src/lib/canvas/director/director-panorama-generation.ts`）；infinite-canvas 的全景插件在提示词前加 equirectangular 约束（`plugins/canvas/panorama/src/index.tsx`）；开源项目 [text-to-360](https://github.com/ilkerzg/text-to-360) 把参考图交给 `gpt-image-2/edit`。优点是复用现有图片编辑接口；缺点是通用模型没有专门训练过 ERP，常见接缝、地平线弯曲和极点畸变，结果不保证是严格 ERP。
2. **透视图投影到 ERP 后外扩（outpaint）**：按假设或估计的视场角（FOV）把源图投影到空白 2:1 画布中央，其余区域作为蒙版交给经全景数据训练的外扩模型。HunyuanWorld 1.0 用 MoGe／UniK3D 估计相机内参后投影，再由 Panorama-DiT 与带噪潜变量拼接生成（[论文](https://arxiv.org/html/2507.21809v1)）；其开源图生全景是 FLUX.1 Fill dev 加 PanoDiT-Image LoRA，默认 FOV 80°、输出 1920×960，并用 `blend_extend` 处理左右边缘（[Wiro 说明](https://wiro.ai/models/tencent/hunyuanworld-image-to-panorama)、[ComfyUI 节点](https://comfy.icu/node/HYWorldImage2Pano)）。社区的 Qwen-Image-Edit 360 LoRA、FLUX.2 Klein 360 ERP Outpaint LoRA 也属于此类，前者把接缝平移到画面中央再局部重绘来消除接缝（[QWEN-EDIT_360](https://huggingface.co/mickmumpitz/QWEN-EDIT_360)、[Panorama Stickers](https://comfyui.nomadoor.net/zh/notes/panorama-stickers/)）。NVIDIA 的 ComfyUI 模板同样是「补边外扩 → 360 LoRA → 扩散 → 接缝重绘」（[NVIDIA 工作流](https://raw.githubusercontent.com/NVIDIA/NVIDIA-GenAI-Creator-Toolkit/main/workflows/04-image-to-equirectangular/README.md)）。
3. **专门的全景生成模型**：直接学习透视图到 ERP 的映射。360Anything 不需要相机参数，把透视输入和全景目标都当作 token 序列交给 DiT，并指出 ERP 接缝的根源是 VAE 编码器的零填充，用循环潜变量编码消除（[360Anything](https://arxiv.org/html/2601.16192v2)）；DiT360 混合透视与全景数据训练，对打包后的 token 网格做循环填充（[DiT360 CVPR 2026](https://openaccess.thecvf.com/content/CVPR2026/papers/Feng_DiT360_High-Fidelity_Panoramic_Image_Generation_via_Hybrid_Training_CVPR_2026_paper.pdf)、[ComfyUI-DiT360Plus](https://github.com/ComfyNodePRs/PR-ComfyUI-DiT360Plus-851d3e33)）；SphereDiff 和 SpheRoPE 是免训练方法，分别在球面潜变量上做多视角融合、把 RoPE 改成球面坐标（[SphereDiff](https://pmh9960.github.io/SphereDiff/)）；CubeAtlas 把立方体贴图六面排进一张画布以避开 ERP 畸变（[Squaring-the-Sphere](https://arxiv.org/html/2610.31565)）。这些方法质量更高，但需要自部署模型，或依赖专门的托管 API。

可直接调用的专门 API：腾讯云 VOD「Hy 3D Panorama」（`CreateAigcImageTask`，`SceneType=3d_panorama`，可带 1 张基准图，样例输出 4096×2048，[接入文档](https://docs.moonheart.space/wand/docs/vod-3d-panorama.en)）；fal 的 `fal-ai/hunyuan_world`（`image_url`＋`prompt`，样例输出 1920×960，[fal 文档](https://fal.ai/models/fal-ai/hunyuan_world/api)）。HunyuanWorld 社区许可证限制欧盟、英国、韩国使用，并对月活超过 100 万的组织另有授权要求（见上方 Wiro 说明）。

### 接缝与极点的工程处理

- 接缝：推理时的循环填充／旋转去噪需要控制模型内部，第三方 API 用不了。可在本地做的后处理有两种：把图像循环平移半宽、把接缝移到中央后局部重绘（要再调用一次收费模型）；或在左右边缘的窄带内做低频颜色校正，只消除亮度和色差断层，不修结构错位。
- 极点：通用模型常把顶部和底部画成拉伸的条纹。只靠后处理无法补出可信内容；查看器可把俯仰限制在 ±85°，减少直接看到极点的机会。

### 生成后的使用方式

同类产品的价值主要在生成之后：在球面查看器里拖动取景，截图成为新的场景／分镜参考图（小云雀、ComfyTV 的 Current View／Multi-View，[ComfyTV 指南](https://comfytv.org/zh/guides/panorama)），或把全景导入导演台作为环境球（LibTV、BeefTV 导演台）。BeefTV 的全景节点用 three.js 的反向球体渲染，支持拖动、方向键、全屏滚轮调 FOV、截图和前右后左四宫格导出（`web/src/components/canvas/nodes/panorama-node.tsx`）。

## Decision

全景生成使用通用图像编辑模型；Gemini 等无 2:1 的模板默认不可用，由用户在能力卡显式加入；生成、查看和本地截图共同交付。专门全景协议待有账号后另立项；导演台、接缝二次重绘、超分不在本期。

### 产品行为

1. **转全景**：图片节点工具区新增「全景」入口，以当前活动版本为源。面板包含模型选择（沿用源节点模型，不兼容时要求显式选择）、可选的「四周环境补充描述」和清晰度选项，确认后立即提交（与多角度相同的一步提交）。结果写入源节点右侧新建的图片子节点并连线，配方记录源 SHA-256。固定单张输出。
2. **查看全景**：任意活动版本宽高比在 2:1 ±1% 内的图片节点（包括 AI 生成和用户上传的全景）显示「720°」角标和「查看全景」按钮。节点内只显示平面缩略图；点击后打开共享的全景查看对话框，支持拖动、方向键、滚轮调 FOV（25°～110°）、重置视角，俯仰限制 ±85°。
3. **截取视角**：查看对话框提供「截取当前视角」和「四向截取」（水平 0°、90°、180°、270°，FOV 90°）。截图比例沿用画布常用比例（16:9、9:16、4:3、3:4、1:1），长边默认 1536，按源图角分辨率提示是否会模糊。截图在本地渲染，免费；上传为项目媒体后在全景节点右侧创建图片节点并连线，可直接作为后续图片、视频生成的参考图。

### 生成路线

首期走「通用图像编辑模型加提示词」：源图作为唯一参考图，engine 按能力卡规划 2:1 输出尺寸，提示词由 canvas 的 `image-edit-prompts.ts` 生成。提示词要求：2:1 等距柱状投影，水平 360°、垂直 180°；地平线位于画面纵向中线；以源图为正前方视角并放在画面中央；补全左右、后方、天空或天花板、地面或地板；左右边缘连续；不出现拼贴、分格、边框、文字、水印、拍摄设备；保持源图的风格、材质、光线和时代特征。用户的补充描述追加在模板中。

专门的全景协议（腾讯云 VOD、fal HunyuanWorld）不在首期范围，原因见 Alternatives；协议层已能按 D4 以代码适配器增加，后续有真实账号与费用授权后另立笔记。

### 契约

- `ImageEditRecipe` 增加 `operation: 'panorama'`：`version`、`source`、`geometry`（只用 `expected`，`crop` 为整图、无补边）、`sceneHint`（≤500 字符）、`tier`（清晰度选项名）。版本仍为 1，新增分支不影响旧配方解析。
- `packages/contracts/src/edit-geometry.ts` 新增 `planPanoramaSize(cap, tier?)`，前端预检与 engine 共用：
  - `pixels` 且有 `custom`：从候选 4096×2048、3584×1792、2880×1440、2048×1024 中过滤满足 `multipleOf`、像素、边长、`withReference` 限制的尺寸，默认选 2880×1440，不可行时取最大可行项。
  - `pixels` 无 `custom`，或 `tier`／`ratio`：只接受像素或比例在 2:1 ±1% 内的已启用格；默认取最高档。
  - `none`、`auto` 或没有 2:1 格：不可用，原因写「能力卡没有 2:1 输出尺寸」。用户可以在能力卡里加入 2:1 格，前提是服务商实际支持。
- `imageEditSupport` 增加 `panorama`：至少一张参考图，且 `planPanoramaSize` 有解。
- 内置模板现状：OpenAI Images（`gpt-image-2` 自定义尺寸，长短边比 ≤3:1）可用；方舟 Seedream 模板（自定义最少 3,686,400 像素、比例 ≤16）可用，2048×1024 因像素不足被过滤；Gemini 模板的比例列表没有 2:1，默认不可用。OpenAI 官方说明 2560×1440 以上属于实验性质（[OpenAI 提示指南](https://developers.openai.com/cookbook/examples/multimodal/image-gen-models-prompting-guide)），所以默认选 2880×1440，不选上限。

### engine

- 创建任务时，`panorama` 分支覆盖前端传入的尺寸参数，写入 `geometry.expected = { ratio: 2, width, height }`，与角度分支一样冻结到任务请求。
- 下载后处理复用表情的中间图／最终图机制（`snapshot.imageEditPostProcess`），重试只做本地处理，不重发供应商请求：
  1. 输出比例在 2:1 ±1% 内：执行接缝颜色校正，最终图作为唯一输出。
  2. 比例不符：中间图原样作为输出，写诊断「输出不是 2:1，不能作为全景查看」，任务仍成功；用户已付费，结果仍可当普通图片使用。画布节点也按活动版本比例显示该提示，不依赖已结束任务的内存引用，因此重新打开项目后仍可见。
- 接缝颜色校正（sharp，确定性）：带宽 `b = max(8, round(W × 2%))`；逐行取左右各 3 列的均值差 `d`，沿纵向做 9 行盒式平滑，在左带内减去 `d/2 × (1 − x/b)`、右带内加上对称值。带外像素逐字节不变。校正前后的边缘差值写入诊断。这一步只消除亮度和色差断层，结构错位仍需重新生成。
- 媒体清理已按快照保护中间图和最终图哈希，源图由配方保护；`project-media.service.ts` 不需要新增分支，实施时用测试确认。

### canvas 与宿主

- 「全景」入口放在 `packages/canvas/src/nodes/image-edit-tools.tsx`，面板使用 shadcn Dialog、主题 token 和 lucide 图标，明暗两种模式都要检查。
- 查看器使用已有依赖 `three@0.185.1`，在对话框打开时按需加载，同一时间只有一个 WebGL 上下文：`texture.mapping = EquirectangularReflectionMapping`，作为 `scene.background`，`colorSpace = SRGBColorSpace`。纹理边长超过 `renderer.capabilities.maxTextureSize` 时先用 `createImageBitmap` 等比缩小。关闭时 `dispose` 并 `forceContextLoss`。
- 截图渲染到离屏 `WebGLRenderTarget`，用 `readRenderTargetPixels` 读出后经 2D canvas 编码为 PNG，不开启 `preserveDrawingBuffer`。视角到相机朝向的换算放在纯函数里，单测不依赖 WebGL。
- 截图节点经 `host.media.upload` 入库，用一步撤销命令批量创建子节点和连线（与 `createImageEditChild` 同一套布局与连线规则）。
- 纹理调用 `host.media.url`：项目画布返回 `frame-project://<projectId>/media/<sha256>`，全局模型测试使用 `frame-media://`。两条协议都返回 `Access-Control-Allow-Origin`，无需放宽 CSP。开发模式与加固目录包 E2E 覆盖项目查看器及全局纹理上传 WebGL。ImageBitmap 解码显式 `flipY`，截图目标使用 sRGB，避免上下颠倒与导出颜色变暗。

## Alternatives considered

- **首期直接接入专门的全景 API（腾讯云 VOD Hy 3D Panorama 或 fal HunyuanWorld）**：最强理由是它们按 ERP 训练，接缝和地平线明显好于通用模型，腾讯云样例输出 4096×2048。不选首期：两者都是新协议（异步任务、签名鉴权或队列），需要新适配器、能力模板、严格模拟和真实账号核对；fal HunyuanWorld 输出只有 1920×960，并受地区与月活许可限制；当前没有对应账号与费用授权，做不了线上验收。协议层已能增量接入，等有真实需求再单独立项。
- **engine 先把源图投影到 ERP 画布中央，再用蒙版让通用模型外扩**：最强理由是这是 HunyuanWorld、ComfyUI 全景工作流采用的几何构造，能把源图固定在正确的球面位置。不选首期：需要 FOV 估计（论文依赖 MoGe 等本地模型，用户手填又难理解）；通用编辑模型没有 ERP LoRA，带畸变的投影画布反而可能被当成普通补边；只有支持蒙版的协议能用。专门模型接入后再评估。
- **Gemini 等没有 2:1 的模型改用 21:9 输出，再非等比缩放到 2:1**：最强理由是 Gemini 默认模板就能用。不选：21:9 到 2:1 需要横向压缩约 14%，ERP 的经度刻度随之失真，查看时物体变窄；[图片编辑输出几何](../../implemented/bug-fix/2026-10-29-image-edit-geometry.md)已确立不做两轴独立缩放。用户确认服务商支持 2:1 后，可以在能力卡里加入。
- **每个全景节点内嵌实时 WebGL 查看器**：最强理由是不用打开对话框，拖动就能看。不选：浏览器限制同时存在的 WebGL 上下文数量（Chromium 约 16 个），画布上全景节点多了会丢失上下文；内嵌拖动还会和画布平移冲突，BeefTV 和 infinite-canvas 都要额外做「交互／移动」切换。节点只显示缩略图更简单。
- **接缝只在查看器的着色器里遮盖，不改存储的图片**：最强理由是 engine 无需新增后处理。不选：下载的全景、截图和导入其他工具的全景仍然带接缝；engine 已有可恢复的后处理机制，接缝颜色校正的代码量小，并且结果确定。
- **接缝平移到中央后再调用一次模型重绘**：最强理由是能修结构错位，社区 360 LoRA 工作流都这样做。不选首期：每张全景多一次收费请求，并且需要蒙版能力；先看颜色校正和提示词约束能否满足实际使用。

## Testing

- `planPanoramaSize` 对 OpenAI、Seedream、Gemini 默认模板，以及手工加入 2:1 的 tier／ratio 能力卡，给出满足全部能力卡限制的严格 2:1 尺寸或明确的不可用原因；前端预检与 engine 结果一致。
- 「全景」只对有效图片节点显示；不兼容模型要求显式选择；提交后创建子节点和连线并可一步撤销；配方保存源 SHA-256，任务冻结 `expected` 尺寸。
- engine 像素夹具：接缝两侧差值降到阈值以下，带外像素逐字节不变；比例不符时输出原图并写诊断；后处理重启后可恢复，且不重发供应商请求。
- 宽高比在 2:1 ±1% 内的图片显示「720°」角标；查看器在开发模式和 Windows 目录包中都能加载 `frame-media://` 纹理，拖动、方向键、FOV 和重置可用，关闭后释放 WebGL 上下文。
- 当前视角与四向截图生成指定比例和尺寸的 PNG，入库后创建子节点并连线，一步撤销；视角换算有纯函数单测。
- 本地模拟服务 E2E 覆盖：OpenAI 模板返回 2:1 PNG → 子节点可查看 → 截图生成新节点；返回 1:1 PNG → 诊断、无角标。明暗主题截图已检查。
- 全仓 typecheck、lint、format:check、build、test 与 `pnpm run verify` 通过。真实模型的全景质量需要用户另行授权费用后单独验收，不在本期声明。

验证证据：contracts 模板与配方测试；engine `image-panorama.test.ts`、`image-edit-geometry.integration.test.ts`、`project-content.integration.test.ts`；canvas 提示词／面板、查看器生命周期、视角和批量撤销测试；desktop `e2e/panorama.test.ts`。模拟服务严格限制为本地 OpenAI 编辑端点，断言两次提交以及 2880×1440；截图像素断言中心方向、地面朝向与 sRGB 色值，五张 PNG 均为 1536×864，四向一次撤销。明暗主题与 720×560 布局截图已检查。关闭查看器释放纹理、位图和 WebGL 上下文由 mock 单测证明；真实渲染由 Electron E2E 证明。

目录包首次在线构建因 Electron 下载网络超时失败；通过 `electron-builder --win --x64 --dir --publish never --config.electronDist=../../node_modules/.pnpm/electron@45.0.0_supports-color@7.2.0/node_modules/electron/dist` 复用当前安装的同版本运行时，正常执行 asar 完整性与 fuses 加固，并通过目录包 E2E。该路径是本次环境的构建参数，不是新增仓库配置。

## Consequences

- 通用模型的全景质量不稳定：可能出现地平线弯曲、极点条纹、接缝结构错位，或者没画成 ERP。颜色校正只修色差。缓解：提示词约束、比例校验诊断、可重新生成；质量不够时转向专门的全景协议。
- 中转站可能改写或拒绝 2:1 尺寸，此时会命中比例诊断，用户要按服务商实际支持调整能力卡。
- 2880×1440 全景在 90° FOV 下约 8 像素／度，截取 1536 宽的视角大约放大 2 倍，会偏软。截图面板按角分辨率提示；需要更清晰的结果时，选更高清晰度或后续接入超分。
- 高分辨率纹理受显卡 `maxTextureSize` 和显存限制；只做等比缩小保护，不做跨显卡矩阵测试。
- 改动跨 contracts、engine、canvas 与 E2E；新增配方分支要接入媒体清理与恢复测试，否则全景源图可能被提前清理。
- 收益：同一场景可以免费截取任意多个一致视角，作为漫剧分镜参考，并为后续导演台的环境球做准备；代价是新增一种编辑配方、一套查看器与截图路径，以及一段 engine 后处理。

## 关联笔记

| 笔记 | 关系 |
| --- | --- |
| [图片编辑工具](2026-10-28-canvas-image-edit-tools.md) | 部分重叠：沿用「不覆盖源节点、子节点连线、配方冻结、engine 后处理可恢复」的约定，本篇为配方新增 `panorama` 分支。 |
| [图片编辑输出几何](../../implemented/bug-fix/2026-10-29-image-edit-geometry.md) | 部分重叠：沿用 `geometry.expected` 和「不两轴独立缩放」，新增 2:1 目标尺寸规划；不改变已有三项编辑的规划规则。 |
| [模型服务配置层重构](../../implemented/architecture/2026-10-28-model-service-rebuild.md) | 相邻：只读取能力卡与协议上限，不修改能力卡格式；新增专门全景协议时回到该篇的协议规则。 |
