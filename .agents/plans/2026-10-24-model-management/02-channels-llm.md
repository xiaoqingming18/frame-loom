# Plan: 渠道与文本模型

Status: done
Parent: plan.md

## 目标

- 用户能在设置中心的"模型服务"页签管理渠道、渠道模型和默认模型。
- 文本模型可以按模型选择协议，并通过 pi-ai 完成两步连通测试。
- 左栏的临时页面"模型测试"有一个文本页签，可以和所选模型做流式对话。

## 前置条件

- 01 完成：写接口、字段加密、`stream()` 可用。

## 步骤

- [x] T1 contracts 定义 `Channel`、`ChannelModel`、`ModelKind`、`LlmProtocol`、`ModelDefaults` 和各请求、响应 schema。密钥只出现在写请求里，读响应只带 `hasKey` 与 `keyHint` — 验证：contracts 测试覆盖合法、非法输入，以及读响应不含密钥字段
- [x] T2 `modules/channels`：
  - 定义 `channels`、`channel_models`、`model_defaults` 三张表并生成迁移；
  - repository 层负责密钥加解密；
  - 提供增删改查接口，删除渠道时级联删除其模型，并把默认模型置空。

  验证：用真实 SQLite 的集成测试覆盖增删改查、唯一约束、级联、数据库文件中搜不到明文 Key
- [x] T3 `fetch-models`：向 `/v1/models` 或按预设对应的接口拉取模型 ID；新拉取的模型默认禁用，类别留空，由用户选择后才能启用 — 验证：集成测试用模拟服务返回模型列表，检查保存结果
- [x] T4 精确锁定版本引入 `@earendil-works/pi-ai`，建立 `modules/llm`：
  - 渠道模型转换成 pi `Model`；
  - 元数据按 pi 内置目录精确匹配，匹配不上标为"需确认"；
  - 实现两步连通测试与 `/llm/test-chat` 流式接口。

  验证：Responses、Chat Completions、Anthropic Messages、Gemini 四协议模拟流测试，覆盖文本、工具调用、用量、HTTP 错误和重定向拦截；`rg` 确认 pi-ai 只在 `modules/llm` 中导入
- [x] T5 renderer 的 `features/model-services`，接入设置中心"模型服务"页签：
  - 渠道列表与表单，含预设、Base URL、密钥打码显示与重新填写；
  - 渠道模型列表，可设置类别、协议、档案和覆盖项；
  - 测试按钮与结果、拉取模型、默认模型选择；
  - 扩展 `settings-search.ts` 的页签枚举。

  验证：组件测试使用替身 client；明暗模式截图检查
- [x] T6 新建 `/model-lab` 路由、`features/model-lab` 和侧栏"模型测试"入口，这一步先做文本页签：选择 chat 类模型后流式对话，显示用量与错误类别 — 验证：组件测试覆盖流式渲染与错误；Electron 模拟服务 e2e 覆盖多轮对话、取消边界和配置重启保留
- [x] T7 原地同步[主题与外壳](../../notes/implemented/feature/2026-10-24-theme-and-app-shell.md)笔记中的侧栏入口与设置页签 — 验证：`pnpm run verify` 通过

## 验证

- 预期：上述测试与 `pnpm typecheck`、`pnpm lint` 通过；开发窗口中添加指向模拟服务的渠道，测试通过，模型测试页的文本对话可用。
- 实际：`pnpm test` 的 contracts 80、desktop 119、engine 119 项通过；桌面 Electron e2e 5 项通过；`pnpm typecheck`、`pnpm lint`、`pnpm format:check`、`pnpm build`、`pnpm run verify` 通过。Electron e2e 对明暗模式分别断言主题背景色，并生成模型服务与文本对话截图。

## 进度

- 2026-10-24：创建子计划草稿。
- 2026-10-25：contracts 80 项测试通过；SQLite 数据库迁移 3 项测试通过；渠道加密、CRUD、默认值清理、模型列表导入等真实 SQLite 集成测试通过。
- 2026-10-25：四协议两步测试与流式对话均由模拟服务通过，包含 HTTP 错误与重定向拦截；renderer 组件测试 6 项通过，覆盖密钥状态、默认模型、流式多轮、错误、失败轮隔离和取消。
- 2026-10-25：Electron e2e 5 项通过，包含渠道新增/拉取/测试、模型配置/默认、明暗主题、两轮文本聊天、持久化和重启后保留；明暗截图的 CSS 背景色已逐一断言。
- 2026-10-25：全仓 318 项测试、类型检查、lint、格式检查、构建、`pnpm run verify` 全部通过；`rg` 确认 pi-ai 仅在 `modules/llm/llm.service.ts` 中导入。真实付费供应商和打包安装版验收留待后续整体计划。

## 发现与偏差

pi-ai 内置目录会加载全部 provider SDK，若模块启动时同步加载会拖慢无配置引擎的启动；因此 metadata/runtime 改为首次调用时动态导入并复用 Promise。Gemini SDK 不接受自定义 fetch，现通过每次调用临时绑定回环地址、随机路径的本地转发器转发到固定 Base URL，并强制 `redirect: 'error'`；本地与协议模拟测试覆盖重定向不抵达目标端。真实 Gemini endpoint 尚无供应商实测，留待后续冒烟验收。

## 交接

02 子计划已完成并通过自动验证；提案笔记仍保持 proposed，因 03～05 尚未交付。代码、迁移、依赖锁文件、提案笔记、原地同步笔记和计划有未提交改动；真实供应商冒烟、安装包验收以及 03～05 均未执行。
