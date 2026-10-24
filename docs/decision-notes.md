# 决策笔记使用指南

## 来源与安装方式

本仓库以项目级副本安装 [write-notes-like-deepseek](https://github.com/czm15053/write-notes-like-deepseek)，路径为 `.agents/skills/write-notes-like-deepseek/`，不依赖开发者全局技能目录。

- [用户指定的说明文档](https://raw.githubusercontent.com/czm15053/write-notes-like-deepseek/refs/heads/main/README.md)。
- [固定的上游源码](https://github.com/czm15053/write-notes-like-deepseek/tree/72573a5b179de7798bbb7c4aeacdc0df6bf62439/skills/write-notes-like-deepseek)。
- 安装来源提交：`72573a5b179de7798bbb7c4aeacdc0df6bf62439`；安装日期：2026-10-24。
- 模板、参考文档、脚本与看板资源保持该提交的原文。更新时审阅上游差异、同步本节来源，并运行校验。
- `tsx` 是开发依赖，具体版本锁定于 `package.json` 和 `package-lock.json`；用 `npm ci` 恢复。

本指南依据上述在线文档和固定源码整理；在线主分支内容可能随时间变化，以本仓库固定版本为准。

## 什么时候写

涉及行为、架构、跨文件契约、工具流程、测试策略或数据／网络／配置格式时留笔记。例如：Electron 主进程与 React 渲染进程的通信边界、模型密钥存储、视频任务恢复、素材落盘格式。

纯样式、格式化、错别字或无行为变化的依赖补丁不单独记录。先检索活跃笔记，有归属就更新既有事实；不要为每个提交建立一篇笔记。

```sh
rg --hidden --glob '!.agents/notes/archived/**' '关键词或模块名' .agents/notes/
```

## 目录与分类

路径：`.agents/notes/{状态}/{分类}/yyyy-mm-dd-topic.md`。日期是首次提出日，流转时不改。按需创建目录，Git 不跟踪空目录，不必预建 24 个占位分类。

| 状态 | 用途 |
| --- | --- |
| `proposed` | 实现前的方案、备选、验收标准与风险 |
| `implemented` | 已落地事实，与代码同步 |
| `rejected` | 被否且有防坑价值的提案，原因写入状态行 |
| `archived` | 已完成使命的已实现决定，保留封印、永久只读 |

| 分类 | 用途 |
| --- | --- |
| `feature` | 产品行为与新能力 |
| `bug-fix` | 缺陷修复与复盘约束 |
| `simplification` | 不增加能力的简化与删减 |
| `architecture` | 模块结构、边界和依赖 |
| `process` | 工具链、流程和协作 |
| `testing` | 测试策略与基础设施 |

不建立 `INDEX.md`；目录就是状态，全文检索用于发现相关理由。

## 创建与落地

1. 阅读技能契约并检索相关活跃笔记，检查是否已存在相同决定。
2. 从 `.agents/skills/write-notes-like-deepseek/templates/proposed.md` 复制到对应分类，填写问题、方案、真实备选、验收标准、风险。正文使用中文，结构标记遵循模板。
3. 写清每条备选最强的理由及不用的原因，明确范围后实施。
4. 实现后移动到 `implemented/`：状态改为 `Status: implemented`，`Proposal` 改为 `Decision`，删除提案式标题，将验收与风险整理为事实、验证与后果。可参考 `templates/implemented.md`。
5. 更新相对链接，运行 `npm run verify-notes`，代码和笔记同次提交。

笔记前三行固定：

```markdown
# Agent Note: 标题

Status: proposed
```

已实现笔记必须有 `Problem`、`Decision`、`Alternatives considered`、`Consequences`，使用现在时描述事实，不能保留 `Proposal`、`Acceptance criteria` 等提案标题。

## 否决与归档

未实现的提案被否时，移动至 `rejected/{分类}/`，参考 `templates/rejected.md`，状态行写为 `Status: rejected — 具体原因`；无防坑价值就删除，不归档。

只有旧的已实现决定完全被替代时才考虑归档。新笔记先接管独特理由、备选和后果，再执行：

```sh
npm run archive-agent-note -- .agents/notes/implemented/architecture/YYYY-MM-DD-old-topic.md --superseded-by .agents/notes/implemented/architecture/YYYY-MM-DD-new-topic.md
npm run verify-notes
```

命令里的日期、分类和主题替换为实际文件。脚本移动旧篇、插入 `Archived:` 行、追加 SHA-256 封印，并报告入站引用；必须按报告修复链接。归档保留 `Status: implemented`，不要改成 `archived`。仅部分取代时两篇保留并互链。

`archived/manifest.json` 只增不改；归档文件不能编辑。`.gitattributes` 统一 LF，避免跨平台换行改变封印。不要靠重新生成旧封印来消除失败。

## 校验与看板

```sh
npm run verify-notes
npm run verify-agent-note-tree
npm run verify-agent-note-format
npm run verify-archived
npm run check-anchors
npm run init-board
npm run bundle-board
```

- 前三项校验分别检查目录／相对链接、正文骨架／状态、归档封印／只增不改，聚合入口是 `verify-notes`。
- 本地归档比较基线默认是 `HEAD`；CI 使用 PR 基线或推送前提交。首次提交没有历史清单时，只检查当前封印。
- GitHub Actions 使用完整历史和 `npm ci`，运行同一个聚合入口。需要仓库托管至 GitHub 才能执行远端校验。
- 本地 `commit-msg` 钩子检查提交信息，操作见 [Git 提交信息规范](git-commit-convention.md)；笔记聚合校验仍须在提交前手动运行。
- `check-anchors` 是可选软报告，不代替门禁，不要求代码额外添加锚点。
- `board.html` 由 Chrome／Edge 读取本地笔记；首次点击「连接本地目录」并选择 `.agents/notes`。`demo.html` 内嵌生成时的数据，适合离线分享；分享前核对笔记内容。

结构检查不能证明技术取舍正确。评审仍需检查真实备选、收益与代价、验证证据及尚未解决的缺口。
