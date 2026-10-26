# Plan: 节点与输入框界面

Status: done
Parent: plan.md

## 目标

按笔记"节点与输入框界面"一节实现，参照 `docs/design/canvas-image-node.html`，颜色只用主题 token：

- 图片节点本体：标题、图片框、上传按钮、右侧"+"、生成中叠层（含"1/3"进度与放弃）、多版本"‹ 2/5 ›"切换。
- 提示词输入框：`NodeToolbar` 挂在节点下方，仅单选时显示、固定屏幕尺寸；头部参考缩略图与展开按钮；辅助行复制与字数；底栏模型、参数摘要、数量与发送按钮（禁用原因 Tooltip）。
- 参数面板：比例网格、清晰度分段、画质滑块、背景胶囊、"更多"、预计像素；整组隐藏、组内置灰、`notes` 角标。
- `packages/ui` 新增 shadcn Slider。
- 视频节点改用同一输入框外壳，参数仍按现有档案字段渲染在"更多"区，生成方式切换保持现状。

## 前置条件

- 02、03 完成。

## 步骤

- [x] T1 新增 `packages/ui/src/components/slider.tsx` — 验证：`pnpm --filter @frame-loom/ui typecheck`
- [x] T2 重做 `packages/canvas/src/nodes/views.tsx` 中图片节点本体与生成中叠层 — 验证：`views.test.tsx` 覆盖空态、生成中进度、版本切换
- [x] T3 新建输入框与参数面板组件，替换 `generation-panel.tsx` 表单；保留低缩放不挂载规则 — 验证：组件测试覆盖档案驱动的隐藏／置灰、摘要文本、禁用原因、预计像素
- [x] T4 模型弹层显示能力说明，数量弹层 ×1–×4 — 验证：组件测试断言切换模型与数量写入节点数据
- [x] T5 视频节点接入同一外壳 — 验证：现有视频生成组件测试与 e2e 通过
- [x] T6 键盘可达与焦点可见、720×560 下不溢出，明暗模式自查 — 验证：桌面非加固测试构建截图记录到 `.cache/canvas-image-node/`；Esc 关闭弹层后恢复焦点

## 验证

- 预期：canvas 与 desktop 单测、typecheck、lint 通过；现有画布 e2e 按新 DOM 更新后通过。
- 实际：`pnpm test` 通过（contracts 141、engine 161、canvas 78、desktop 136 项）；后续增加 Gemini 清晰度测试后 `pnpm --filter @frame-loom/canvas test` 79 项通过。`pnpm typecheck`、`pnpm lint`、`pnpm format:check`、`pnpm run verify` 通过。
- 桌面回归：`pnpm --filter @frame-loom/desktop test:e2e generation-image.test.ts canvas-shell.test.ts`、`canvas-organize.test.ts`、`canvas-persistence.test.ts` 对应 5 项用例分批通过，覆盖三张图片生成、失败单张重试、首帧视频、整理、存储故障、重启与最小窗口；已按新浮层 DOM 更新生成和整理测试。
- 明暗自查：`.cache/canvas-image-node/composer-small-{light,dark}.png`、`params-small-{light,dark}.png`。实际截图核对输入框、参数面板、上传、焦点与工具栏避让；参数面板可独立滚动，边界断言通过。加固 exe 与中文 @ 输入法仍由 06 验收，不在本步骤宣称完成。

## 进度

- 2026-10-26：创建子计划草稿。
- 2026-10-26：开始执行；复用现有任务创建、写回、重试与导入逻辑，界面改用节点下方浮层。
- 2026-10-26：完成 T1–T6；新增 `generation-composer.tsx`、`generation-params.tsx`、`generation-status.tsx` 与 Slider，更新单测、桌面用例及相关笔记，明暗小窗口截图完成自查。

## 发现与偏差

- 输入框按画布可用区域收窄至最多 620px；空间不足优先放到节点上方，无法完整放下时避开标题并允许输入框滚动，为公共工具栏留空间。仅按整个窗口限制尺寸会被画布边界裁掉，已用桌面截图复核。
- 输入框和弹层隔离键盘事件，避免 Radix 关闭弹层的 Esc 继续触发 xyflow 取消选择。整理测试改在露出的节点边缘打开右键菜单，全览后通过键盘单选再断言输入框。
- Gemini 尺寸由供应商决定，contracts 不返回像素尺寸；界面只对 OpenAI／Seedream 显示换算后的预计像素，不伪造 Gemini 像素值。
- 头部新增 @ 按钮、引用候选与拖动排序属于 05；04 只展示现有连入参考缩略图，未提前实现引用编辑。

## 交接

无。05 可在 `generation-composer.tsx` 替换 Textarea 并接入引用菜单；生成请求边界仍在 `generation-panel.tsx`。父计划和主笔记继续保持 active／proposed，等 05、06 完成后统一收尾。
