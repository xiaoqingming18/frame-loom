# Agent Note: 图片编辑的开发模式 WASM 加载与有效模型能力修复

Status: implemented

## Problem

2026-10-28 用户在图片编辑功能实现后报告两项问题：点击「表情」出现 Vite public 资源模块导入错误，三个编辑面板均提示「所选模型不支持此图片编辑操作」，同名模型在工作室 BeefTV 中可以使用。诊断基线为 `9eda94d`。后续用户通过 /goal 授权完成全部修复子计划；仅使用临时数据和本地模拟服务验收，不调用收费供应商或修改真实用户目录。

关联的[图片编辑实现笔记](../../implemented/feature/2026-10-28-canvas-image-edit-tools.md)保留原功能决定与历史证据，本篇只持有这两项修复及其验证边界。

### 诊断基线的事实与证据边界

1. `packages/canvas/src/nodes/face-detection/worker.ts` 的 `self.import` 先删除 URL 中的 `?import`，再执行动态导入。当前安装的 Vite 8.3.5 开发转换仍会为这个表达式注入 `__vite__injectQuery(..., 'import')`；`@vite-ignore` 抑制分析告警，不禁止该注入。public 服务遇到 `?import` 会让请求进入模块转换并拒绝导入，符合用户截图。前一轮只读诊断看到原 loader URL 返回 200、带 `?import` 返回 500，且开发转换后的 worker 含上述 helper；资源文件和 publicDir 实际存在。这是开发模式模块加载问题，不是模型文件或 WASM 二进制缺失。
2. Vite 的 query helper 对首字符为 `.` 或 `/` 的 URL 注入 query，完整的 `http://...` 和 `app://...` URL 保持不变。生产 worker 输出没有该开发转换，生产 `app://frame-loom` 同源 handler 已映射 renderer 静态资源。因此原目录包验收不能代替开发模式真实检测。
3. `packages/contracts/src/image-edit.ts` 在能力对象缺失或操作不在列表时返回同一句警告；多角度、打光和表情面板均使用它，engine 创建任务也重复共享校验。警告由本地前置判定产生，不是上游模型已经返回不支持。
4. desktop 从 `/channel-models` 直接消费有效档案。`ModelCatalogService` 初始化标记已存在时跳过合并，读取又优先采用数据库目录；即便初次合并，同 id 的持久定义优先。`executionProfile()` 没有补齐可选的 `imageEditCapabilities`，因此缺字段的旧定义能一直进入 UI 和 engine。重启、重编译不能保证消除这一缺口。
5. 当前内置编辑能力仅在 OpenAI 图片档案中声明；Gemini／Ark 未声明，但其适配器已有发送提示词和参考图的实现。多角度、打光属于单参考图语义编辑；表情另有已确认的 OpenAI Images、多参考图及蒙版降级要求。服务操作 `submit/edit` 与三个配方的 `angle/lighting/emotion` 不是同一层级。
6. 尚未取得用户实际选择的模型及其运行时 `effectiveProfile`，不能把“本机旧目录导致此次告警”写成定案。实施时需用脱敏只读结果区分旧定义缺字段、当前定义未声明、显式收窄和真实协议不支持；同名上游模型不证明两项目接入协议完全相同。

## Decision

### WASM loader：在动态导入边界使用完整同源 URL

保留现有 bundled module Worker、MediaPipe 的 `importScripts` 回退和本地 JS／WASM／模型资源。当前实现将清理后的 loader 地址先用 `new URL(cleanPath, self.location.href).href` 转为完整 URL，再交给带 `@vite-ignore` 的动态导入。相对解析以 worker 所在的真实 origin 为基准；当前根路径会分别得到开发 `http://.../mediapipe/...` 和生产 `app://frame-loom/mediapipe/...`。

该改动不需要 fetch／Blob 生命周期，不改变 publicDir、资源内容或 WASM 路径，也不增加 CSP 中的 `blob:`／远端脚本许可。清理 query 只是兼容处理，避免 Vite 再次注入的关键是完整 URL。本次真实开发检测已返回 faces 数组，不只依靠字符串或资源 HTTP 200。

### 当前模型能力来源

[模型服务配置层重构](../architecture/2026-10-28-model-service-rebuild.md)已删除旧目录升级与 effectiveProfile。当前由用户 ImageCap、协议上限及共享 imageEditSupport 判断编辑、参考数量与蒙版，画布与 engine 使用同一结果。旧兼容补齐不再运行；以下归一化与迁移说明保留为原缺陷的历史处理依据，WASM 同源加载决定仍有效。

### 历史模型能力修复（旧目录兼容已移除）

能力计算留在现有 engine 模型定义／有效档案边界，desktop 继续消费 `effectiveProfile`；不在三个面板中分别猜模型名，也不从 `/model-profiles` 给画布私自合并能力。该接口可用于诊断内置与持久档案差异，但不能覆盖绑定、接入和用户限制。

- 多角度、打光按实际有效图片参考模式、输入数量和适配器执行边界表达支持，不额外要求 OpenAI 专有协议；明确的操作禁用继续生效。为支持参考图的 Gemini／Ark 定义补齐对应的语义编辑声明，不把未知模型一概判成支持。
- 表情保留 OpenAI Images 和多参考图要求，蒙版不支持时保留已确认的本地合成降级，不把角度／打光放行扩展成所有协议均支持表情。
- 先区分“旧版本字段缺失”和“当前版本明确不支持”。缺失通过全部旧字段匹配的内置定义升级获得能力；显式空操作列表、较低参考数、禁用蒙版以及自定义定义不能被兼容代码覆盖。来源无法判定时显示待更新／能力未确认，不自动增加权限；migrated 或修改过名称／约束／输入的同 id 定义仍走现有显式目录更新。
- ModelCatalogService 使用独立的 `image_edit_capabilities_v1` 标记，在旧初始化标记存在时仍检查补齐；不复用／删除 `model_bindings_v1`，不重置用户库。只有缺能力且其余全部字段与内置旧快照匹配才更新，比较遵循 JSON 落盘语义（键序无关，undefined 不持久化）。实际写入前 VACUUM INTO 备份；备份失败停止升级，目录与标记事务写入，重复启动不重复写入或备份。
- 更新只影响新任务，保留旧任务冻结档案、凭据、素材及恢复目的地。不改变供应商地址、渠道密钥、现有媒体或用户已收窄参数。
- 提示区分档案缺失／待升级、操作被禁用、协议不兼容和参考数量不足；engine 保留相同拒绝语义。可通过已有通知位置展示，不增加独立设置系统。

### 验证范围与成本

loader 改动只需一个 URL 边界测试，覆盖当前根路径、完整开发 URL、生产 app URL 和现有清理逻辑；不复制 Vite helper 实现或给 node_modules 写测试。本次完成真实 Vite 开发检测，确认 Worker 成功响应（空人脸列表也是检测成功）、loader 无 `?import`、JS／WASM／模型加载成功及无 overlay；原有 mock 和手动框选不能替代。

能力修复使用少量 contracts 参数化用例、临时旧目录集成夹具和一个画布模型选择用例。重点覆盖初始化标记已存在、旧档案缺字段、重复升级、显式收窄／自定义定义保留、新任务校验与 UI 一致、历史任务快照未被重写。无需真实供应商调用，也不重复表情像素处理或通用任务恢复矩阵。

本次完成生产构建及当前 Windows x64 目录包同源加载冒烟，验证完整 app URL 与当前 CSP 兼容；若失败则修复后定向重验，不把“一次”当成禁止必要重试。无新增布局时不重复明暗／小窗截图；只有错误提示与模型选择的可访问性需要针对性检查。只运行受影响测试、一次类型检查与相关 lint／格式／文档校验；若实际扩大到其他共享行为，再增加有理由的回归。

### 活跃笔记审计

| 笔记 | 归属处理 |
| --- | --- |
| [图片编辑实现](../../implemented/feature/2026-10-28-canvas-image-edit-tools.md) | 部分重叠；新增互链，保留功能决定和当时验收事实，旧验收不替代本次真实运行时证据。 |
| [模型服务与能力演进](../../rejected/architecture/2026-10-27-model-service-experience-and-evolution.md) | 部分重叠；补互链，沿用定义／接入交集、升级确认与历史任务冻结约定，本篇不接管其余未完成验收。2026-10-28 该篇已转 rejected，编辑能力来源改由[模型服务配置层重构](../architecture/2026-10-28-model-service-rebuild.md)的能力卡与协议上限持有。 |
| [主题与应用外壳](../../implemented/feature/2026-10-24-theme-and-app-shell.md) | 相邻约束；本修复不扩大 CSP，不改变主题系统，无需重写其历史决定。 |
| [图片节点语义参数](../../implemented/feature/2026-10-26-canvas-image-node.md) | 相邻实现；比例、清晰度、普通多图和引用语法保持原义，不吸收或归档。 |

## Alternatives considered

- **完整复用 BeefTV 的 fetch → Blob → import**：优点是已有工作示例，能绕过开发模块转换；但 Frame Loom 当前脚本 CSP 不允许 blob，需要额外权限及对象 URL 清理。完整同源 URL 能避免这次 query 注入，改动和安全边界更小，故不采用 Blob 路径。
- **关闭 Vite overlay 或只在生产使用**：最快隐藏开发报错且可能不影响现有目录包；但真实人脸检测仍失败，开发与生产行为继续分叉，不能作为修复。
- **前端缺能力时直接合并当前内置档案**：界面可迅速解除警告；engine 仍可能拒绝，而且绕过持久定义、接入限制和用户收窄，产生两份能力来源，不采用。
- **重置整个模型目录或给所有模型默认开放三操作**：最容易让警告消失；会覆盖用户定义与明确限制，表情也不是任意图片协议可执行，不符合既有配置和安全边界。
- **维持缺字段一律不支持且要求用户换模型**：最保守，不需要目录升级；但把旧元数据缺失误报为模型能力不足，也遗漏已经实现参考输入的角度／打光路径，不能解决同模型差异。

## 验证结果

- contracts 图片编辑规则 5/5；canvas URL 边界 4/4、图片编辑组件 6/6；原目录集成测试和新增临时旧目录升级测试均通过。覆盖未知／禁用、三协议、参考模式／额度、蒙版、备份、初始化标记存在、幂等、限制保留及历史任务整行不变。
- 真实 Vite 与本次 Windows x64 加固目录包专项 E2E 2/2 通过，均返回 faces 数组和 256×256；开发 loader 无 import query、无 pageerror／overlay，两端 loader／WASM／tflite 均 200。
- 临时旧目录实际重启升级后，UI 选择 GPT Image 2.5 通过本地模拟服务完成角度、打光及本地融合表情；Gemini 表情在 UI 与 engine 均提示 OpenAI Images 协议要求，422 且无额外请求。代表截图保存在忽略的测试产物内。
- 新目录包复用本机 Electron 45.0.0 构建；生产仅通过 renderer CDP 验收，没有修改 fuse、启用主进程 inspect 或扩大 CSP。
- `pnpm run typecheck`、实际变更源码 ESLint、变更文件 Prettier、`pnpm run verify` 及 `git diff --check` 均通过。新增测试类型与 OffscreenCanvas context 夹具问题已修正并定向复验。
- 未取得用户实际模型有效档案；仅确认代码／临时目录路径，不宣称其本机旧目录根因已核实。无收费供应商调用。

## Consequences

- 本次最小 loader 方案依赖当前安装 Vite 的 query helper 行为；真实开发检测是必须的结果验证。将来升级工具链时如复发，再依据实际请求调整，不扩成通用动态加载框架。
- 旧目录没有可靠来源或字段版本时，无法只根据同 id 判定内置与用户自定义。应保留原数据并要求现有更新预览／显式处理，不用便利性覆盖用户意图。
- 本轮不证明上游模型的美术质量，也不以模型名称相同推断协议与蒙版能力。未取得用户现场档案前，旧目录是有代码证据的可能原因，不是已核实的本机事实。

收益是开发／生产资源加载一致、旧目录与新执行能力衔接，以及更准确的操作限制；代价是补齐能力升级兼容及少量跨层回归。功能范围仍为已确认的三个图片工具。

安全补齐的代价是修改过或来源不明的定义不会自动获得能力，仍需显式更新；备份占用磁盘且失败阻止升级。未重复全仓 E2E、25 预设／像素合成／多图矩阵、主题／小窗截图、NSIS、跨 GPU 或收费测试。
