# Agent Note: 图片编辑输出几何与表情回贴对齐

Status: proposed

## Problem

2026-10-29 用户报告表情编辑结果的人物面部被纵向拉长（竖幅源图约 250×357，结果下巴变长、五官下移）。只读排查得到以下事实：

1. 表情提交时 `packages/canvas/src/nodes/emotion-workspace.tsx` 传 `params: {}`。`packages/contracts/src/image-size.ts` 的 `resolveImageSize` 因而回落到能力卡默认档位；OpenAI Images 模板默认 `1K`／`1:1`，适配器 `openai-images.ts` 发送 `size=1024x1024`。
2. engine `apps/engine/src/modules/generation/image-emotion.ts` 的 `resolveEditRegion` 以脸框外扩并按源图边界截断，竖图得到约 0.75 的竖长裁切区域。
3. 同文件 `compositeEmotion` 用 `resize(width, height, { fit: 'fill' })` 把方形结果非等比缩回裁切区域，再在椭圆羽化区内贴回原图。纵横缩放倍数不同（示例约 0.244 与 0.322）直接造成拉伸。
4. canvas 侧照搬原版的 `emotionGenerationSize`（按裁切比例选 1024×1536／1536×1024／1024×1024）在合成迁入 engine 时漏接，全仓无调用；`buildEmotionImageArtifacts`、`compositeEmotionImage`、`normalizeEmotionPromptForProvider` 同样成为无人调用的重复实现。
5. 比例对齐后，模型整张重绘仍可能让五官平移数像素；当前合成不做对齐，椭圆蒙版比脸框外扩约 22%～28%，偏移会在发际线和耳侧形成重影。
6. 多角度提交同样传 `params: {}`；重打光经通用生成面板使用 `defaultMediaParams`，也是默认 1:1。二者不回贴，不会拉伸，但会把竖图改成方图并改变构图。

外部事实（2026-10-29 查阅）：`gpt-image-2` 与 `gpt-image-2.5-sunburst`／`gpt-image-2.5-flare` 支持 `WIDTHxHEIGHT` 自定义尺寸，宽高为 16 的倍数、长短边比不超过 3:1、单边不超过 3840、总像素 655,360～8,294,400，见 [OpenAI 图像生成指南](https://developers.openai.com/api/docs/guides/image-generation) 与 [openai-ruby Size 文档](https://rubydoc.info/gems/openai/OpenAI/Models/ImageGenerateParams/Size)。内置 OpenAI Images 能力卡的 `size.custom` 与之一致。编辑接口 `/images/edits` 对 2.5 的自定义尺寸未在 SDK 编辑参数说明中核实；中转站是否放行任意尺寸取决于其实现。

参考项目 EditHere（`D:\WorkSpace\project\personal\reference_projects\EditHere`）不调用任何模型，没有局部重绘或合成管线；它的“精准改图”是向下游 AI 交付无损原图、像素坐标和移动矩形。可借鉴的是几何契约：原图像素空间唯一、坐标整数化、每一步映射可逆、映射不成立时拒绝而不猜测。

失败条件：任一编辑结果出现非等比缩放；表情最终图尺寸不等于源图或蒙版外像素被改变；比例不符时静默拉伸或重新提交收费请求。

## Proposal

### 共享几何规划

在 `packages/contracts` 新增纯函数 `planEditGeometry(cap, sourceRect)`，engine 与 canvas 共用，产出：

- `crop`：源图像素空间的裁切矩形（多角度、重打光为整图）。
- `pad`：为满足输出比例在裁切图四周补的边（上下左右像素数），补边色取裁切图边缘均值。
- `request`：写入 `SemanticRequest.params` 的尺寸，`pixels` 加 `custom` 时为 `width`/`height`，否则为 `tier`/`aspectRatio`。
- `expected`：期望输出宽高或比例。

求解规则：

1. `size.wire === 'pixels'` 且存在 `size.custom`：在 `multipleOf`、`minPixels`、`maxPixels`、`maxEdge`、`maxAspect` 内求与“裁切加补边”同比例且像素数接近当前档位的宽高；比例超过 `maxAspect` 时补边到上限比例。
2. `pixels` 无 `custom`、或 `tier`／`ratio`：选已启用比例中与裁切比例最接近的一格，补边到该比例。
3. `wire === 'none'` 或 `auto`：不发尺寸，`expected` 只记比例为未知，合成阶段按实际输出等比处理并校验（见下）。
4. 无可行解时抛出带原因的错误，前端预检与 engine 均拒绝提交。

### 配方契约

`ImageEditRecipe` 三种操作增加可选 `geometry`（`crop`、`pad`、`expected`），由 engine 在创建任务时计算并冻结到任务请求；前端只做预检展示，不作为可信输入。表情配方中的 `editRegion` 由 `geometry.crop` 取代。旧任务缺 `geometry` 时以原 `editRegion` 为 `crop`、无补边；因其请求已按 1:1 发出且不能重新提交，比例不符时降级为等比缩放后居中裁切，并在任务诊断中提示，不判失败。`version` 保持 1，新字段可选以兼容已保存画布和在途任务。

### 表情准备与合成

- `emotionArtifacts` 按 `geometry` 裁切并补边，蒙版与补边后画布同尺寸；`request.params` 由 engine 写入，覆盖前端传入的尺寸参数。
- `compositeEmotion` 先校验输出比例：与 `expected` 相差超过 1% 时任务进入后处理失败，保留中间图并允许重试合成，不重发供应商请求。比例合格时只做等比缩放，再裁掉 `pad` 映射回 `crop`，删除 `fit: 'fill'`。
- 回贴前做轻量对齐：在缩小灰度图上，以蒙版外应保持不变的环带为样本，搜索小范围平移（及可选 ±3% 等比缩放），取误差最小者；残差超过阈值时仍写回结果，但在任务诊断中提示“模型改动了非编辑区域”。
- 椭圆蒙版收紧到眉眼、脸颊和嘴部，减少头发与轮廓覆盖；保留边缘颜色校正。
- 删除 canvas 侧无人调用的 `buildEmotionImageArtifacts`、`compositeEmotionImage`、`emotionGenerationSize`、`normalizeEmotionPromptForProvider` 及其私有辅助函数。

### 多角度与重打光

- 多角度提交时用 `planEditGeometry` 以整图为 `crop` 求尺寸写入 `params`。
- 重打光创建子节点时把同一尺寸预填到子节点 `params`，通用生成面板显示该尺寸；用户手动改尺寸属显式选择，不阻止。
- 二者结果不回贴，engine 只校验比例偏差并在诊断中提示，不失败任务。
- 三项操作的提示词构建集中到一个按 `recipe` 生成的模块；engine 可据配方重建并核对，前端只收集参数。

## Alternatives considered

- **只接回 `emotionGenerationSize`**：最强理由是改动最小、能立即消除 OpenAI 下的大部分拉伸。不选：它只认三个 OpenAI 标准尺寸，裁切比例与 2:3、3:2、1:1 仍不完全相同，残余拉伸依然存在；对只支持档位／比例的协议和角度、打光无效。
- **合成改为 `fit: 'contain'`／`cover` 而不控制请求尺寸**：最强理由是不涉及 contracts 与配方。不选：比例不符时 `contain` 会留空、`cover` 会裁掉内容，脸部位置仍与源图错开，对齐只能掩盖问题。
- **采用 EditHere 方式，交付原图加坐标让模型整图重出**：最强理由是无需本地合成与对齐，契约简单。不选：表情需求是“只改脸、其余像素与原图一致”，整图重出无法保证蒙版外像素不变，也会带来身份漂移；EditHere 本身不包含生成或合成，只取其坐标契约纪律。
- **打光改为只迁移生成图低频亮度、保留原图高频细节**：最强理由是可避免打光后的身份漂移。不选本期：属于效果增强而非本缺陷修复，需要单独效果验收，列为后续方向。

## Acceptance criteria

- contracts：`planEditGeometry` 覆盖 OpenAI（pixels＋custom）、无 custom 的 pixels、Gemini（tier＋ratio）、`none`／`auto`、超出 `maxAspect` 与无可行解；求得尺寸满足能力卡全部限制，比例误差小于 1%。
- engine：确定性像素夹具下，补边→等比还原的往返误差为 0；模拟返回错误比例时任务后处理失败、保留中间图、不重发请求；模拟平移若干像素后能对齐回原位；最终图尺寸等于源图，蒙版外像素与源图逐字节一致。
- 多角度、重打光：请求 `size` 与源图比例一致；重打光面板显示预填尺寸。
- 旧画布与在途任务（无 `geometry`）可加载、可完成，不再非等比缩放。
- canvas 侧重复表情实现已删除，类型检查、lint、相关单测和 `pnpm run verify` 通过。
- E2E 用本地模拟服务覆盖竖图、方图和错误比例三种返回；真实模型对竖图、横图、多人图各做一次人工效果对比，需用户另行授权费用。

## Risks

- 中转站可能只放行标准尺寸或改写 `size`，此时比例校验会让表情任务后处理失败。缓解：错误信息指向尺寸不受支持，用户可改用能力卡收窄为 `ratio`／标准档位，规划器会走补边路径。
- 补边区域可能被模型画入内容；因合成会裁掉补边，影响有限，但会占用部分像素预算。
- 对齐搜索增加 engine CPU 开销，需在缩小图上进行并限制搜索范围；高分辨率源图下需实测耗时。
- `/images/edits` 对 2.5 自定义尺寸的支持未实测；上线前需一次真实请求确认。
- 回滚条件：比例校验在主流模型上误报频繁时，可把失败降级为诊断警告，但仍禁止 `fit: 'fill'`。

## 关联笔记

| 笔记 | 关系 |
| --- | --- |
| [图片编辑实现](../../implemented/feature/2026-10-28-canvas-image-edit-tools.md) | 部分重叠；该篇持有三项功能、配方与 engine 合成的原始决定，本篇修正其输出几何缺口并收紧蒙版，不改变产品行为范围。 |
| [图片编辑运行时修复](../../implemented/bug-fix/2026-10-28-canvas-image-edit-runtime.md) | 相邻；WASM 加载与能力判定不受影响。 |
| [模型服务配置层重构](../../implemented/architecture/2026-10-28-model-service-rebuild.md) | 相邻；能力卡 `size` 结构由该篇持有，本篇只读取，不修改能力卡格式。 |
