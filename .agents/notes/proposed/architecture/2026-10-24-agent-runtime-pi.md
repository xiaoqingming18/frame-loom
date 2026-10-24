# Agent Note: Agent 内核选用 pi（pi-agent-core 加 pi-ai）

Status: proposed

## Problem

剧本、分镜、出图、出视频等基础能力做完后，产品要接入 Agent，让「剧本 → 资产 → 成片」全流程可以自动跑。要决定的是 Agent 内核自己写，还是用成熟的第三方。如果用第三方，在 OpenCode 和 pi 之间选哪个。

这个决定影响：

- 进程模型：是嵌在 engine 里，还是另起一个旁路进程。
- 数据归属：会话和消息记录存在哪里。
- 领域服务的接口形态。

决定要现在定下来，因为基础能力的服务接口从一开始就要让 Agent 能调用。

约束：

- 影视生产的大部分步骤是确定的业务操作，要能落库、重试、断点续跑、计费。这部分不管选哪个 Agent 都要自己写。
- 视频生成耗时几分钟，不能让一次模型调用一直等到它完成。
- engine 用 NestJS 12，整体 ESM（见 [技术栈与进程模型](../../implemented/architecture/2026-10-24-desktop-stack-and-process-model.md)）。

## Proposal

### 分层

- **生产能力**由 engine 的 NestJS 领域服务实现，手动界面和 Agent 调用的是同一批服务。
- **编排**交给 Agent：理解用户意图，决定调用顺序，判断要不要重来，什么时候停下来等人确认。
- Agent 的工具只是领域服务外面的一层薄包装，不放业务逻辑。

### 选型

- 用 `@earendil-works/pi-agent-core` 和 `@earendil-works/pi-ai`，在 engine 进程内直接 `new Agent()`。不另起进程，也不占端口。
- pi-ai 统一了多家模型厂商的流式接口。pi-agent-core 负责工具调用循环、参数校验，并提供以下钩子和机制：
  - `beforeToolCall` / `afterToolCall`
  - 运行中插话 `steer`、追加消息 `followUp`
  - 中断 `abort`
- 权限和确认流程由我们自己在 `beforeToolCall` 里实现：只暴露领域工具，不暴露 bash 和文件系统；批量出视频这类高成本操作要先请求用户确认。
- 会话和消息记录存在 engine 自己的 SQLite 里，和项目数据放在一起。

### 隔离与锁版本

- 只有 `apps/engine` 里的 `agent` 模块可以直接 import pi。其他模块只依赖我们自己定义的工具接口和事件类型。以后要换内核，改动只限在这一个模块里。
- pi 的版本精确锁定，不用 `^`。升级单独提交，并跑 Agent 的回归测试。
- 2026-10-24 的最新版本是 1.4.0。npm 包名已经从 `@mariozechner/*` 改成了 `@earendil-works/*`。

### 耗时任务的约定

- 出视频这类耗时工具，提交任务后立刻返回任务 ID，不在工具调用里等待结果。
- 任务完成后，由任务表的事件通过 `followUp` 把结果交回 Agent，开始下一轮。
- 这一层恢复逻辑我们自己实现，不依赖 pi：进程崩溃后，按任务表和消息表恢复。

### 时机

首个骨架里程碑不安装 pi。等第一个领域能力需要 Agent 时，再引入并建立 `agent` 模块。本篇先定选型和边界。

## Alternatives considered

- **内置 OpenCode**（竞品和 [OpenWork](https://github.com/different-ai/openwork) 的做法）：最强的理由是子 Agent、MCP、Skill、上下文压缩、权限确认流程都是现成的。竞品已经用它验证过「按广告片、短剧、MV 分类的工作流，用 Markdown 定义」这种形态，产品如果希望用户或运营随时新增工作流，它最省事。不选的原因：
  - 它面向写代码，自带读写文件和 bash 等工具，我们要么关掉，要么用权限挡住。
  - 要多管一个旁路进程。竞品内置的 `opencode.exe` 有 178 MB，还要处理端口、健康检查和版本兼容。
  - 会话存在它自己的库里，和项目数据是两套。
  - 能在进程内嵌入的 `@opencode-ai/sdk-next` 目前只有 Effect 版本，还是未公开的 beta（见[官方 SDK 文档](https://opencode.mintlify.site/build/sdk)）。
  - 版本变化快，OpenWork 正在迁移到 OpenCode v2。
- **完全自写 Agent 循环**：没有外部依赖，行为完全可控，最小的循环几百行就能写完。代价是多厂商流式接口统一、工具参数校验、运行中插话和中断都得自己写和维护，pi 已经把这些做好了，而且是 MIT 许可证。
- **pi-durable**（同一生态里的持久化 Agent 运行时）：每次提交都先落库，进程崩溃后能接着跑，正好对上影视任务耗时长的问题。不选的原因是它的 README 写明「Experimental. The API changes without notice between releases」。先用我们自己的任务表和消息表做持久化，等它稳定后再评估。
- **Mastra 或 Vercel AI SDK**：社区资料多，火宝短剧用的就是 Mastra。讨论中用户把候选限定在 OpenCode 和 pi，我们没有展开比较这两个，这里只记录它们存在。

## Acceptance criteria

- 引入 pi 时，`apps/engine` 里只有 `agent` 模块直接 import `@earendil-works/*`，可以用 grep 检查。
- pi 在 `package.json` 里写精确版本。
- 第一个 Agent 能力上线时，用假模型跑通「生成剧本 → 抽取资产 → 生成分镜」三个工具，并覆盖两点：耗时任务异步返回后能接上下一轮；进程中途退出后能按任务表恢复。

## Risks

- pi 的 API 改动频繁，比如 `shouldStopAfterTurn` 已被 `finishTurn` 取代，包名也改过。新贡献者提的 issue 和 PR 默认被自动关闭，我们碰到的问题可能得不到上游响应。缓解办法是锁版本、把 pi 隔离在单一模块里，必要时 fork。
- pi 没有权限系统和持久化，这两样要我们自己写。
- pi-ai 内置 OpenAI、Anthropic、Google 等多家厂商的 SDK，实测装出来 66.2 MB，会增大安装包。
- pi 要求 Node 22.19 以上，Electron 45 内置的 Node 24.22.0 满足要求。以后 pi 提高 Node 下限时，要先确认 Electron 内置的 Node 版本跟得上。
- 如果产品方向变成「Agent 自由规划、可以临时新增 Markdown 工作流」，OpenCode 的现成能力会更值钱，到时另写笔记重新评估。
