# Git 提交信息规范

Frame Loom 采用 [Conventional Commits 1.0.0](https://www.conventionalcommits.org/zh-hans/v1.0.0/)：英文类型、可选英文范围、中文摘要与正文。本文规定后续新增提交，创世提交保持原样。

## 格式与标题

```text
<type>[(scope)][!]: <中文摘要>

<可选正文：动机、关键变化、实际验证>

<可选尾注>
```

- 类型必填、小写英文。范围可省略；填写时只能是小写英文字母或短横线连接的单词，例如 `ai`、`model-provider`，一个提交只选一个主要范围。
- 使用半角括号和冒号，冒号后恰好一个空格。摘要不能为空，首尾无空白，结尾不加中英文句号，不加 emoji 前缀。
- 标题建议不超过 50 字符，硬上限 72 字符，包含类型和范围，按字符而非字节计。
- 摘要和正文使用简体中文，专有名称、代码标识符和版本号保留原文；依赖机器人生成的合规英文摘要可保留。
- 摘要使用「新增、支持、修复、避免、移除、调整、统一」等具体动词，说明结果，不写「优化代码」「一些修改」「fix bug」「WIP」。
- 机械性小改可以只有标题；非平凡改动简述动机、行为变化和实际验证，未验证说明原因。正文按自然段组织，不硬套英文列宽。
- 标题与正文、正文与第一条尾注之间留空行。相邻尾注不必空行。

## 类型与边界

| 类型 | 场景 | 写法示例，不代表功能已实现 |
| --- | --- | --- |
| `feat` | 新增用户或调用方可使用的能力 | `feat(ai): 支持参考图生成分镜草稿` |
| `fix` | 修复与预期不一致的行为 | `fix(timeline): 修复拖动片段后的音画错位` |
| `perf` | 不改变行为语义的性能优化，正文给出证据 | `perf(media): 复用缩略图缓存减少重复解码` |
| `refactor` | 不新增能力、不修缺陷的内部结构调整 | `refactor(ipc): 统一媒体任务消息类型` |
| `docs` | 文档或仅笔记变更 | `docs(notes): 补充归档操作说明` |
| `test` | 仅测试或测试基础设施变更 | `test(media): 补充任务取消的边界测试` |
| `build` | 构建、打包、运行时或构建依赖 | `build(deps): 升级 Electron 至已验证版本` |
| `ci` | 持续集成配置 | `ci: 增加 Windows 打包检查` |
| `style` | 不改变含义的格式、缩进、空白 | `style(renderer): 统一组件文件格式` |
| `chore` | 其他仓库维护或开发工具调整 | `chore(repo): 配置提交信息模板` |
| `revert` | 回退既有提交 | `revert(ai): 回退不稳定的模型适配` |

`style` 不表示界面视觉变化：新增能力用 `feat`，修复显示缺陷用 `fix`。运行时和构建依赖用 `build(deps)`，纯开发质量工具可用 `chore(deps)`。不要把无测量证据的重构称为性能优化，`chore` 不掩盖功能与修复。

范围按实际模块使用，暂不设置封闭白名单：

| 方向 | 建议词汇 |
| --- | --- |
| Electron 与前端边界 | `main`、`preload`、`renderer`、`ipc` |
| 业务 | `project`、`assets`、`timeline`、`ai`、`media` |
| 工程 | `repo`、`notes`、`deps`、`release` |

这些词汇不预设目录或架构。跨目录但同一业务目的仍选该业务范围，没有主要归属时省略。

## 尾注与破坏性变更

| 尾注 | 用途 |
| --- | --- |
| `Note: .agents/notes/...` | 对应笔记，路径相对仓库根目录 |
| `Plan: .agents/plans/...` | 可选，本提交推进的实施计划或子计划，路径相对仓库根目录 |
| `Refs: #123` | 相关问题；跨仓库使用完整 URL |
| `Closes: #123` | 确实解决，并应随默认分支合入关闭的问题 |
| `Reverts: <完整提交 SHA>` | `revert` 提交必须指定回退目标 |
| `BREAKING CHANGE: ...` | 破坏性变更的影响对象、不兼容点和迁移方法 |

非平凡改动关联本次新建或更新的笔记，实现引用 `implemented/`，仅方案文档可引用 `proposed/`。不为小改强制创建 Issue 或笔记。

破坏性变更必须同时在标题冒号前加 `!` 并填写 `BREAKING CHANGE:`（兼容标准别名 `BREAKING-CHANGE:`）。包括 IPC／公开契约、项目文件格式、配置或工作流的不兼容变化；普通内部重命名不自动构成 breaking change。实际提交必须写清已提供的迁移方式。

```text
feat(project)!: 将项目文件升级为带版本号的清单格式

说明修改原因和本次实际验证结果。

BREAKING CHANGE: 说明旧项目的影响及实际可用的迁移方法。
```

以上仅为格式示例，实际实现还需关联真实笔记。标记不等于自动发版，本仓库没有配置自动版本递增。签名、DCO、共同作者和 AI 署名不强制；不得编造身份信息。

## 提交粒度

- 一个提交承载一个可描述、可验证、可回退的逻辑变化，不夹带无关格式化或依赖升级。
- 同一功能的实现、必要测试、文档和笔记同次提交，按主目的选择类型，不强拆 `docs`／`test`。
- 仅笔记变化用 `docs(notes)`。笔记的六类与提交类型独立。
- `fixup!`、`squash!`、`WIP` 不进入最终主干历史，本地钩子也会拒绝它们；需要使用 Git 临时修正工作流时自行整理后再提交规范消息。
- Git 默认生成的 `Merge branch ...`、`Merge pull request ...` 等合并消息豁免格式检查。普通回退采用 `revert` 格式，默认 `Revert "..."` 消息需要改写。
- 尚未确定 PR 合并策略；若后续采用 squash，PR 标题及最终 squash 提交也必须合规，并增加相应标题检查。

## 本地使用

环境：Node.js 24.22.x、Corepack、Git，pnpm 版本由 `packageManager` 锁定。新克隆后执行：

```sh
corepack enable pnpm
pnpm install --frozen-lockfile
pnpm run setup:git
```

安装依赖的 `prepare` 自动启用 Husky。`setup:git` 再将提交模板配置到当前仓库的 `.git/config`，不更改全局设置。钩子和模板路径分别为 `.husky/_` 和 `.gitmessage.txt`，本地路径不随 Git 克隆；移动仓库后可重新运行设置命令。

```sh
git add <相关文件>
git commit

# 检查某个 UTF-8 消息文件
pnpm run verify-commit-message --edit <消息文件>

# 检查基线之后到目标之间的所有提交，基线本身不包含在内
pnpm run verify-commits --from <基线SHA> --to HEAD

# 不提供基线时检查全部可达历史，包含根提交
pnpm run verify-commits

# 规则及真实 Git 钩子集成验证
pnpm run test:commit-convention
```

提交钩子只检查消息，不自动修改消息或暂存文件。GUI 提交需要进程环境能找到 Node.js；Windows Git 使用自带的 shell 执行 Husky 钩子。

`git commit -m` 不打开模板，但仍执行钩子。可先修改消息再重试，禁止用重新提交或回退用户已有改动的方式修正单纯消息错误。

## CI 与验证边界

`.github/workflows/verify-commits.yml` 在 Ubuntu／Windows 运行同一规则与集成测试：PR 检查 `base.sha..head.sha`；main 推送检查 `before..sha`；首次推送的全零基线或手动运行检查完整历史。基线无法解析会失败，不降级为只检查最后一条提交。删除事件的全零目标没有提交可检查。

CI、生产依赖安装和 `HUSKY=0` 跳过钩子安装，CI 仍显式运行消息检查。GitHub 上需要开启对应分支保护／规则集才能把检查作为合并门禁；本次配置文件不代表远端已执行或已设保护。

commitlint 检查类型、结构、范围格式、长度、空行、句号、回退目标和成对破坏性标记。中文表达、真实验证、笔记必要性及迁移充分性由评审负责。钩子可能被跳过，CI 复检新增提交仍有必要。

决策来源及四项目调研见[提交规范决策笔记](../.agents/notes/implemented/process/2026-10-24-git-commit-message-convention.md)。工具依据：[Husky 安装与 CI 说明](https://typicode.github.io/husky/how-to.html)、[commitlint 规则](https://commitlint.js.org/reference/rules.html)。在线文档可能变化，具体工具版本由本仓库锁文件固定。
