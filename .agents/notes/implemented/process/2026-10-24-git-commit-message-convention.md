# Agent Note: 为 Frame Loom 建立 Git 提交信息规范

Status: implemented

## Problem

Frame Loom 的 Electron、React、模型接入和媒体处理开发需要从 Git 历史区分能力、修复、兼容性变化和工程维护，并追溯对应决策。规范需要兼顾中文阅读与现成工具生态，避免为初期个人项目增加无收益的表单工作。

## Decision

采用 Conventional Commits 1.0.0 结构，英文类型、可选英文范围、中文摘要和正文。用户已审查并批准规范及实施方案。正式规则位于 `docs/git-commit-convention.md`，`AGENTS.md` 作为协作入口，`.gitmessage.txt` 提供中文注释模板。

- 类型为 `feat`、`fix`、`perf`、`refactor`、`docs`、`test`、`build`、`ci`、`style`、`chore`、`revert`，标题建议不超过 50 字符、上限 72。`style` 仅表示格式变化，不表示界面视觉调整。
- 范围可省略，只允许小写英文字母和短横线连接的单词，一个提交一个主要范围；模块尚未建立，不冻结范围白名单。
- 破坏性变更同时使用标题 `!` 与 `BREAKING CHANGE:`（兼容标准别名 `BREAKING-CHANGE:`），正文或尾注说明影响与迁移方法；回退使用 `revert` 和 `Reverts:` 完整 SHA。
- 一个逻辑变化同次提交实现、必要测试、文档与笔记，非平凡改动通过 `Note:` 关联本次新增或更新的笔记，可选 `Plan:` 尾注关联推进的实施计划（见 [todo-plan 工作流](2026-10-24-todo-plan-workflow.md)）；仅笔记修改使用 `docs(notes)`，提交类型与笔记分类独立。
- Git 默认合并消息豁免格式检查；`fixup!`、`squash!`、仅版本号等默认忽略被关闭，避免临时消息进入最终历史。创世提交 `a0b5dc3` 保持原样且符合格式。

### 工具与安装

本地和 CI 使用同一 `commitlint.config.mjs`。锁定 `@commitlint/cli` 与 `@commitlint/config-conventional` 为 `21.2.4`、Husky 为 `9.1.7`。commitlint 的最低运行要求是 Node.js 22.12.0；项目按[工具链决策](2026-10-24-pnpm-node24-toolchain.md)统一使用 Node.js 24.22.x 和 pnpm，项目引擎声明为 `>=24.22.0 <25`，CI 使用 Node.js 24.22。

继承常规规则，补充项目标题格式、尾注空行与回退 SHA 检查。移除上游英文摘要大小写及百列正文限制，保留专有名称和完整路径。语义、中文表达、真实验证、笔记必要性与迁移质量由评审判断，不用正则冒充语义检查。

`pnpm install --frozen-lockfile` 的 `prepare` 自动准备 Husky；`pnpm run setup:git` 设置当前仓库 `core.hooksPath=.husky/_` 和提交模板，不修改全局设置。CI、生产依赖安装、`HUSKY=0` 跳过设置；源代码副本无 `.git` 时准备阶段跳过。钩子只检查消息，不修改或暂存文件。跨平台入口直接启动 Node 执行 commitlint，避免 Windows `.cmd` 引号差异。

### CI 与范围

`verify-commits.yml` 在 Ubuntu 和 Windows 使用完整 Git 历史、锁定依赖，执行规则测试并复检消息。PR 使用 `base.sha..head.sha`，main 推送使用 `before..sha`。首次推送的全零基线和手动运行检查包含根提交的完整历史；全零目标表示删除，没有提交可检查。引用先解析为 SHA，无法解析的基线直接失败，不静默漏检；范围内每条消息都检查，不能只检查最后一条。

尚未确定 PR 合并策略，也没有自动发版。后续采用 squash 时，PR 标题及最终 squash 提交同样合规，并增加标题检查。远端强制门禁依赖 GitHub 的分支保护／规则集，本次只提供工作流文件。

### 调研依据

2026-10-24 直接抓取 [GitHub Trending 日榜](https://github.com/trending?since=daily) 与[周榜](https://github.com/trending?since=weekly)，核对四项目约定或提交指令，并各抽查默认分支最近 12 条提交。榜单是当次抓取快照，不是长期评价；短样本不能证明全仓库绝对一致。在线主分支会变化，下列源码固定到当时提交。

| 项目与榜单位置 | 核实的做法 | 借鉴点 |
| --- | --- | --- |
| Node.js，日榜第 8 | `subsystem: description`；标题建议 ≤50、最多72字符；解释变化与理由；正文约72列；DCO 与 PR 首提交 CI 检查 | 简短标题、影响范围与理由可追溯 |
| OpenCode，周榜第 5 | PR 标题和项目提交指令采用 `type(scope): summary`，六种类型、范围可选；实际历史有 `feat(ai)`、`fix(core)` | 类型与范围分离，说明具体用户变化 |
| ComfyUI，周榜第 10 | 要求 `Fix`／`Add`／`Support` 等简短动词标题，实际历史混合普通与部分 Conventional 格式 | 一个逻辑变化一次提交，不堆砌模板 |
| Hyperframes，周榜第 12 | 所有提交采用 Conventional；commitlint 继承常规配置，Lefthook `commit-msg` 执行校验 | 现成工具执行规则，媒体产品领域范围 |

来源与提交样本：

- Node.js：[提交规范](https://github.com/nodejs/node/blob/b12bad4b1119608ba98dcfdcddb4fabaa3c93daf/doc/contributing/pull-requests.md#commit-message-guidelines)、[CI](https://github.com/nodejs/node/blob/b12bad4b1119608ba98dcfdcddb4fabaa3c93daf/.github/workflows/commit-lint.yml)、[实际提交](https://github.com/nodejs/node/commit/b12bad4b1119608ba98dcfdcddb4fabaa3c93daf) `build,deps,tools: prepare to update to OpenSSL 4.1`，其前缀不是 Conventional 类型。
- OpenCode：[贡献指南](https://github.com/anomalyco/opencode/blob/c272a63cb4dd86a3e8771cf9a03be051fae28e95/CONTRIBUTING.md#use-conventional-titles)、[提交指令](https://github.com/anomalyco/opencode/blob/c272a63cb4dd86a3e8771cf9a03be051fae28e95/.opencode/command/commit.md)、[实际提交](https://github.com/anomalyco/opencode/commit/50989519c732757463af77ace7be190b3a26c890) `feat(ai): portable image shape with aspect and resolution (#58528)`。
- ComfyUI：[提交习惯](https://github.com/Comfy-Org/ComfyUI/blob/dea870e1a36614b3614c0008a820734d0fecdf4f/AGENTS.md#commit-and-review-habits)、[实际提交](https://github.com/Comfy-Org/ComfyUI/commit/dea870e1a36614b3614c0008a820734d0fecdf4f) `Add a Branch node (#16383)`。
- Hyperframes：[贡献指南](https://github.com/heygen-com/hyperframes/blob/7a34d6fbe4a663c44a067f194ad1302233f68157/CONTRIBUTING.md#pull-requests)、[commitlint](https://github.com/heygen-com/hyperframes/blob/7a34d6fbe4a663c44a067f194ad1302233f68157/commitlint.config.js)、[钩子](https://github.com/heygen-com/hyperframes/blob/7a34d6fbe4a663c44a067f194ad1302233f68157/lefthook.yml)、[实际提交](https://github.com/heygen-com/hyperframes/commit/828adc1ce7404a7530ff88fdfbc23986fed4ed00) `fix(engine): await seek completion during drawElement batches (#5430)`。
- 标准：[Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/)。标准允许破坏性标记择一，本项目要求成对填写；长度、语言、范围与尾注必填条件为项目补充约定。
- 安装依据：[Husky](https://typicode.github.io/husky/how-to.html)、[commitlint 规则](https://commitlint.js.org/reference/rules.html)。在线说明可能变化，依赖由锁文件固定。

## Related notes

检索活跃笔记，只有[仓库与决策笔记初始化](2026-10-24-repository-and-decision-notes.md)部分重叠。本篇补充提交约定，保留该篇的笔记流程与选型理由，并同步其钩子现状；没有决定完全失效，无需归档。

## Alternatives considered

- **ComfyUI 式动词标题**：自然、输入成本最低；缺少统一机器类型和范围，不利于后续能力、修复和兼容性分类，因此借鉴简洁与单一逻辑原则，采用 Conventional 结构。
- **Node.js 子系统前缀**：定位复杂运行时影响准确、流程成熟；前缀本身不区分功能与修复，因此将其思想用于可选范围，保留标准类型。
- **英文全文、范围必填、封闭白名单**：国际协作与机械一致性强；当前中文为主、模块未定，冻结范围增加维护成本，因此范围可选，模块稳定后再评估收紧。
- **只校验 PR 标题并依赖 squash**：外部贡献门槛低，主干可整理；当前本地提交为主要历史入口且未确定合并策略，因此检查新增提交，未来采用 squash 再扩展标题检查。
- **纯手写校验器**：依赖更少且规则完全可控；会重复维护解析、尾注与 Conventional 语法，因此使用 commitlint，仅实现项目差异规则和跨平台调用入口。

## Consequences

- 收益：规范、模板、钩子和 CI 随仓库恢复，中文历史可读且保留机器结构。错误消息在本地及时反馈，绕过本地钩子的错误仍能被范围检查发现。
- 代价：增加 3 项直接开发依赖、提高 Node.js 下限、每次提交增加校验启动耗时；11 种类型需要通过示例维护边界，避免 `chore` 吞没真实目的。
- 可选范围降低初期维护成本，也可能产生同义词；模块稳定后统一，不预先强制固定架构。
- 钩子可被跳过，格式也不能证明内容真实，仍需代码评审与远端分支保护。当前未托管执行 GitHub Actions，Ubuntu／Windows CI 配置不代表两个远端环境已经通过。
- 中文全文适合当前协作；国际贡献者增加时需要单独讨论语言政策。正式发版前另行确定 0.x 兼容性与发布策略，不由提交类型自动推断已有发布机制。
- `.git/config` 不随克隆迁移，模板需执行 `setup:git`；移动目录后重新运行即可。GUI 提交依赖 Node 可被进程找到。

## Verification

- `pnpm run test:commit-convention`：27 个消息正反例；另在依赖缓存内建立隔离 Git 仓库，验证真实钩子拒绝错误消息、接受合法消息与模板注释且不修改消息，CI 跳过安装，范围覆盖根提交及多条提交、拒绝未知基线、检出中间的错误消息。
- Windows Git 不接受 Node 空设备路径作为全局配置文件；测试使用临时空 Git 配置隔离用户设置。清理前验证绝对路径在本测试缓存目录内。
- `pnpm install --frozen-lockfile` 和 `pnpm run setup:git`：恢复锁定依赖并启用当前仓库钩子及模板。
- `pnpm run verify-notes`：目录、相对链接、状态与格式、归档封印检查。
- `pnpm run verify-commits`：同一配置检查现有可达提交；真实实施提交经过已安装的 `commit-msg` 钩子。
- `git diff --cached --check`：检查提交内容空白错误。远端 CI 运行结果在推送后确认。
