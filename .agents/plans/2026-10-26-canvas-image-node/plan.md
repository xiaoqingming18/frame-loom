# Plan: 画布图片节点参数与输入框

Status: active
Note: ../../notes/proposed/feature/2026-10-26-canvas-image-node.md

## 目标

达成[画布图片节点方案](../../notes/proposed/feature/2026-10-26-canvas-image-node.md)的验收标准：

- 图片节点参数统一为比例、清晰度、画质、背景与数量，按模型族档案动态置灰或隐藏，切换模型就近回退并提示。
- engine 按模型族前缀匹配档案，三个图片适配器由共享换算函数生成供应商请求体。
- 数量 ×N 提交 N 个任务，各自写回版本、可单张重试；旧文档的 `pendingJobId` 迁移为 `pendingJobIds`。
- 节点本体与提示词输入框对齐 `docs/design/canvas-image-node.html`，明暗模式通过人工验收。
- 提示词支持 @ 引用参考，提交时按提示词语言替换为"图N"／"Image N"。

## 范围与非目标

- 范围：`packages/contracts`（档案字段、尺寸换算、参数回退、引用替换、画布媒体数据）、`apps/engine/src/modules/generation`（图片档案、档案匹配、三个图片适配器、产物 mime）、`packages/ui`（新增 Slider）、`packages/canvas`（节点视图、输入框、参数面板、@ 编辑器、多任务运行时与写回、节点迁移）、`apps/desktop` 的画布测试与 e2e、相关笔记原地同步。
- 非目标：视频节点的参数能力与 @ 引用（下一轮调研，本期只让视频节点复用输入框外壳）；Gemini 3.1 的 512 档与极端比例、Seedream 5.0 档案；真实供应商冒烟（归模型管理验收）；缩略图服务；模型设置页改版。

## 子计划

| 编号 | 子计划 | 状态 | 依赖 | 交付物 |
| --- | --- | --- | --- | --- |
| 01 | [统一参数契约](01-param-contracts.md) | done | — | contracts 中的语义参数、`notes`、尺寸换算、参数回退、引用替换纯函数与单测 |
| 02 | [图片档案与适配器](02-engine-profiles.md) | done | 01 | 模型族档案、前缀匹配、三个适配器请求体、产物 mime、请求固件 |
| 03 | [多任务数据与运行时](03-multi-job.md) | draft | 01 | `pendingJobIds`、`count`、节点迁移、多任务提交／写回／删除确认 |
| 04 | [节点与输入框界面](04-node-composer.md) | draft | 02、03 | 节点本体、输入框、模型／参数／数量弹层、Slider、视频节点复用外壳 |
| 05 | [@ 引用参考](05-mentions.md) | draft | 04 | contentEditable 编辑器、候选列表、自动连线、失效检测、提交替换 |
| 06 | [验收与收尾](06-acceptance.md) | draft | 05 | e2e、明暗人工验收、笔记转 implemented、相关笔记同步 |

## 依赖与顺序

- 关键路径：01 → 03 → 04 → 05 → 06。
- 可并行：02 与 03 都只依赖 01；04 需要 02 的档案数据来驱动面板。

## 验收

- [ ] contracts、engine、canvas、desktop 单测与组件测试通过，`pnpm test`、`pnpm typecheck`、`pnpm lint`、`pnpm format:check` 通过 — 证据：各子计划验证
- [ ] 桌面 e2e 覆盖多张生成与单张重试、切换模型回退、@ 引用编号、旧文档迁移后补写 — 证据：06 验证
- [ ] 开发版与加固 exe 明暗人工验收通过，720×560 不溢出，中文输入法在 @ 编辑器内正常 — 证据：06 验证
- [ ] 笔记转入 `implemented/`，无限画布与模型管理笔记原地同步，计划转 `done` — 证据：06 收尾

## 发现与偏差

- 01、02 已完成；OpenAI 1K 独立 16 对齐在四个比例上略超 1% 误差，改为误差超限时局部选择相邻合法尺寸，详见 01 的发现与偏差及关联笔记。02 同步统一媒体入口的图片前缀匹配并向适配器传递任务档案快照，保留旧 `*-default` ID；JPEG 固件下载入库已验证。03–06 保持 draft。
