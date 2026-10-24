# Plan: 渠道与文本模型

Status: draft
Parent: plan.md

## 目标

- 用户能在设置中心的"模型服务"页签管理渠道、渠道模型和默认模型。
- 文本模型可以按模型选择协议，并通过 pi-ai 完成两步连通测试。
- 左栏的临时页面"模型测试"有一个文本页签，可以和所选模型做流式对话。

## 前置条件

- 01 完成：写接口、字段加密、`stream()` 可用。

## 步骤

- [ ] T1 contracts 定义 `Channel`、`ChannelModel`、`ModelKind`、`LlmProtocol`、`ModelDefaults` 和各请求、响应 schema。密钥只出现在写请求里，读响应只带 `hasKey` 与 `keyHint` — 验证：contracts 测试覆盖合法、非法输入，以及读响应不含密钥字段
- [ ] T2 `modules/channels`：
  - 定义 `channels`、`channel_models`、`model_defaults` 三张表并生成迁移；
  - repository 层负责密钥加解密；
  - 提供增删改查接口，删除渠道时级联删除其模型，并把默认模型置空。

  验证：用真实 SQLite 的集成测试覆盖增删改查、唯一约束、级联、数据库文件中搜不到明文 Key
- [ ] T3 `fetch-models`：向 `/v1/models` 或按预设对应的接口拉取模型 ID；新拉取的模型默认禁用，类别留空，由用户选择后才能启用 — 验证：集成测试用模拟服务返回模型列表，检查保存结果
- [ ] T4 精确锁定版本引入 `@earendil-works/pi-ai`，建立 `modules/llm`：
  - 渠道模型转换成 pi `Model`；
  - 元数据按 pi 内置目录精确匹配，匹配不上标为"需确认"；
  - 实现两步连通测试与 `/llm/test-chat` 流式接口。

  验证：模拟 Responses、Chat Completions、Anthropic Messages 三种流式服务，断言文本增量、工具调用、用量统计和错误类别；grep 确认 pi-ai 只在 `modules/llm` 中导入
- [ ] T5 renderer 的 `features/model-services`，接入设置中心"模型服务"页签：
  - 渠道列表与表单，含预设、Base URL、密钥打码显示与重新填写；
  - 渠道模型列表，可设置类别、协议、档案和覆盖项；
  - 测试按钮与结果、拉取模型、默认模型选择；
  - 扩展 `settings-search.ts` 的页签枚举。

  验证：组件测试使用替身 client；明暗模式截图检查
- [ ] T6 新建 `/model-lab` 路由、`features/model-lab` 和侧栏"模型测试"入口，这一步先做文本页签：选择 chat 类模型后流式对话，显示用量与错误类别 — 验证：组件测试覆盖流式渲染与错误；开发窗口中能与模拟服务对话
- [ ] T7 原地同步[主题与外壳](../../notes/implemented/feature/2026-10-24-theme-and-app-shell.md)笔记中的侧栏入口与设置页签 — 验证：`pnpm run verify` 通过

## 验证

- 预期：上述测试与 `pnpm typecheck`、`pnpm lint` 通过；开发窗口中添加指向模拟服务的渠道，测试通过，模型测试页的文本对话可用。
- 实际：未执行。

## 进度

- 2026-10-24：创建子计划草稿。

## 发现与偏差

无。

## 交接

未开始，依赖 01。
