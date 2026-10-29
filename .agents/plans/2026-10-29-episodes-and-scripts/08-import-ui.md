# Plan: 导入对话框与转换进度

Status: active
Parent: plan.md

## 目标

剧本页接上导入和转换的完整流程，规格见功能笔记「剧本页」中的导入对话框、转换进行中和未完成导入三部分，以及「状态与恢复」一节。具体包括：

- 导入对话框：文本框加字数统计；项目设定不完整时用精简表单补填，完整时显示一行摘要并提供「修改」；提示当前使用的默认文本模型，或提示没有配置；已有段落时先确认是否替换；导入前先完成编辑器的保存；
- 转换进行中：骨架屏并锁定编辑；显示进度条、阶段文字、批次计数和「取消」按钮；进度由 `/events` 驱动；
- 转换完成：用 `role="status"` 的提示显示结果，带「查看」按钮，有警告时可以展开；
- 未完成导入或转换失败：提示条提供「继续转换」「编辑原文」「丢弃」；
- 工具栏的「重新导入」和「查看原文」可用。

## 前置条件

- 04、06 已完成。
- 已阅读 `project-canvas.tsx` 第 220–230 行附近订阅 `/events` 的写法，以及 `lib/model-queries.ts` 中的 `defaultsQuery` 和 `modelsQuery`。

## 步骤

- [x] T1 新建 `script/import-dialog.tsx`：
  - 对话框宽 720px，主体是等宽字体的 Textarea，显示「n / 200000」字数；
  - 项目设定不完整时，文本框上方显示黄色提示条。样式写在 `script/script-editor.css` 的 `.script-warning` 类中，用 `var(--tag-yellow-bg)` 作背景、`var(--tag-yellow)` 作文字颜色。现在没有映射到 Tailwind 的 tag 类，所以不新增 `@theme` 映射，也不使用任意值颜色。提示条里嵌入 `ProfileFields` 的 `compact` 模式，三项都填好之前「开始转换」保持禁用；
  - 设定完整时，只显示一行「按『<formatProfile>』识别」和「修改」按钮，点击后展开 `compact` 表单；
  - 用 `defaultsQuery` 和 `modelsQuery` 取默认文本模型的显示名，显示「使用 <名称> 识别」；没有默认文本模型时，显示笔记中的提示文案；
  - 已有段落时，点击「开始转换」先弹出二次确认，文案照抄笔记；
  - 提交前先调用编辑器的 `flush()`，失败时停止提交；然后发送 `POST import`，请求体为 `{ revision, text, profile? }`；遇到 422 `PROJECT_PROFILE_REQUIRED` 时，显示设定字段并标为错误；
  - 「编辑原文」入口打开这个对话框时，预填 `pendingImport.text`。

  — 验证：组件测试覆盖以下几点：
  - 设定不完整时，「开始转换」在补齐三项之前禁用，补齐后请求体带 `profile`；
  - 设定完整时，请求体不带 `profile`；
  - 没有默认模型时显示提示文案；
  - 已有段落时出现二次确认；
  - `flush` 返回 false 时不发送请求。
- [x] T2 新建 `script/conversion-banner.tsx`：
  - 剧本页订阅 `/events`，收到 `script.conversion.updated` 且 projectId、episodeId 匹配时，重新获取 `scriptQuery`；
  - 状态为 `queued` 或 `running` 时，编辑器设为只读，编辑区换成骨架屏，顶部显示进度条、阶段文字（split 对应「切分场次」，classify 对应「识别段落类型」，extract 对应「提取人物与场景」，match 对应「匹配设定库」）、「已处理 done / total 批」，以及「取消」按钮；
  - 转换成功后，显示提示「已识别 S 场、B 段，新增 N 个待确认元素」和「查看」按钮（打开右栏）；有 `warnings` 时追加「部分内容按规则识别」，可以展开查看原因；
  - 刚完成的转换只显示一次结果提示：比较转换完成时间和页面打开时间，不新增持久化字段；
  - `draft` 为 true 且没有运行中的转换时，显示提示条，提供「继续转换」（发送不带 `text` 的 `POST import`）、「编辑原文」和「丢弃」（`DELETE import`）；转换失败时，提示条中显示错误信息。

  — 验证：组件测试使用模拟的 `stream`，依次推送 running、succeeded 两个事件，覆盖以下几点：
  - 运行期间编辑器不可编辑，阶段文字正确；
  - 成功后显示结果提示，提示中的数字来自 `result`；
  - 点击「取消」发送 cancel 请求；
  - 「继续转换」的请求体不带 `text`；
  - 「丢弃」发送 `DELETE` 请求。
- [x] T3 接上工具栏和空白状态卡片：
  - 「粘贴整集剧本」卡片和「重新导入」按钮都打开导入对话框；
  - 「查看原文」打开只读抽屉，显示 `source.text`，并在左侧显示行号；没有 `source` 时禁用；
  - 剧集列表中的状态列使用同一套状态文字，事件到达时使 `episodesQuery` 失效。

  — 验证：组件测试覆盖：没有 `source` 时「查看原文」禁用；有 `source` 时，抽屉显示原文。

## 验证

- 预期：
  - `pnpm --filter @frame-loom/desktop typecheck` 通过；
  - `pnpm --filter @frame-loom/desktop exec vitest run --project renderer src/renderer/src/features/projects` 通过；
  - 对改动的文件运行 `pnpm exec eslint` 通过。

  本子计划不运行 e2e，完整流程由 10 覆盖。
- 实际：projects 定向测试先前 90 项通过；补充页面级模拟 stream，验证 running 锁编辑、succeeded 结果刷新、原文入口禁用和只读抽屉，剧本目录累计 66 测试通过。模拟模型挂起的生产 e2e 验证进度与取消；明暗截图已逐张查看，明亮骨架与背景同色问题改用 accent token 修复。

## 进度

- 2026-10-29：创建子计划草稿。

## 发现与偏差

无。

## 交接

实现及页面级事件、原文抽屉、模拟模型进度验收完成；暂保持 active，等待依赖 06 的真实输入法检查。
