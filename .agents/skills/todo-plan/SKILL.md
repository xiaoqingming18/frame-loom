---
name: todo-plan
description: Use when a change spans multiple commits or sessions, or needs more than a screen of ordered steps, to write or update an implementation plan in .agents/plans/ that links to its decision note. Covers single-file plans, two-level parent/child plans for large requirements, progress and handoff updates, and the verify-plans gate. Not for recording why a decision was made; that belongs to write-notes-like-deepseek.
---

# Todo Plan：配合决策笔记的实施计划

决策笔记回答「为什么、放弃了什么」；实施计划回答「怎么做、做到哪、怎么证明」。两者分开存放，计划单向链接到笔记。计划不复述理由，笔记不依赖计划。

## 1. 先判要不要写

需要计划，满足任一条即可：

- 预计跨多次提交，或需要跨会话、跨上下文压缩继续；
- 有序步骤超过一屏，或存在必须先后完成的依赖；
- 大型需求需要拆成可独立验收的子任务。

不写计划：

- 单次提交可完成的改动，用会话内 todo 即可；
- 纯机械改动；
- 只是记录取舍。取舍写决策笔记，不写计划。

非平凡改动先按 `write-notes-like-deepseek` 写或更新笔记，再写计划。

## 2. 选择形态

```text
.agents/plans/
  2026-11-10-settings-store.md        # 单文件计划：一个笔记、一个连续任务
  2026-11-02-media-pipeline/          # 父子计划：大型需求
    plan.md                           # 父计划：目标、拆分、依赖、汇总验收
    01-ffmpeg-binding.md              # 子计划：可独立验收的一段工作
    02-render-task-queue.md
```

- 文件名与目录名用 `yyyy-mm-dd-topic`。日期是首次创建日，之后不改；topic 只用小写字母、数字和短横线。
- 子计划文件名用 `NN-topic.md`，两位编号表示建议顺序，依赖只能指向更小的编号。
- 层级上限为两层：父计划 + 同级子计划，禁止孙计划。子计划仍过大时，拆成更多同级子计划，或提升为独立的父计划。
- 父计划目录至少有一个子计划；单文件计划需要拆分时，改成同名目录并把原文件内容并入 `plan.md`。
- 一份子计划通常对应一到数次提交，交付物可以单独验证。

## 3. 头块（脚本校验）

```markdown
# Plan: <标题>

Status: active
Note: ../notes/proposed/process/2026-11-10-settings-store.md
```

- 第 1 行 `# Plan: <标题>`，第 2 行空行，第 3 行 `Status:`，其后紧接 `Note:` / `Parent:`，再空一行进入正文。
- `Status:` 取值见 §4。`blocked`、`dropped` 后必须带 ` — <原因>`。
- `Note:` 是从计划文件出发的相对路径，指向 `.agents/notes/` 中的笔记，可写多行。父计划和单文件计划至少写一行。子计划可选，用于指向子决策笔记。
- 确实没有对应笔记时写 `Note: 无 — <原因>`，例如纯机械的大批量迁移。
- 子计划必须写 `Parent: plan.md`。

## 4. 状态流转

| 状态 | 含义 | 约束 |
| --- | --- | --- |
| `draft` | 与 proposed 笔记一起评审中 | 不得有已勾选步骤；父计划为 draft 时，子计划只能是 draft/dropped |
| `active` | 评审通过，正在执行 | 子计划 active 时，父计划必须 active |
| `blocked — <原因>` | 外部条件阻塞 | 子计划 blocked 时，父计划为 active 或 blocked |
| `done` | 已完成并通过验证 | 无未完成步骤；依赖的子计划均 done；父计划 done 需全部子计划为 done/dropped |
| `dropped — <原因>` | 放弃执行 | 父计划 dropped 时，未完成的子计划也标为 dropped |

与决策笔记联动：

1. 笔记 `proposed` 阶段，计划为 `draft`，两者同批评审。
2. 用户确认后，计划转 `active` 开始施工；同一会话内仍可用 todo 跟踪当前步骤。
3. 收尾提交同批完成三件事：笔记移入 `implemented/` 并按笔记规则改写；计划 `Note:` 路径改到新位置；计划转 `done`。父计划或单文件计划为 `done` 时，`Note:` 不得仍指向 `proposed/`。
4. 计划被放弃时转 `dropped — <原因>`。对应提案按笔记规则转 `rejected/` 或删除。
5. 计划完成后原地保留，作为执行记录与验证证据，不移动、不删除。

## 5. 章节骨架（脚本校验存在与顺序）

各形态的必备章节如下，必须按顺序出现，中间可插入自由章节。

- 父计划：`## 目标` → `## 范围与非目标` → `## 子计划` → `## 依赖与顺序` → `## 验收` → `## 发现与偏差`
- 子计划：`## 目标` → `## 前置条件` → `## 步骤` → `## 验证` → `## 进度` → `## 发现与偏差` → `## 交接`
- 单文件计划：`## 目标` → `## 范围与非目标` → `## 前置条件` → `## 步骤` → `## 验证` → `## 进度` → `## 发现与偏差` → `## 交接`

父计划的 `## 子计划` 使用固定表格，状态列只写状态关键字，必须与子计划文件一致；依赖写编号，以 `、` 或 `,` 分隔，没有依赖写 `—`。

```markdown
| 编号 | 子计划 | 状态 | 依赖 | 交付物 |
| --- | --- | --- | --- | --- |
| 01 | [主进程与预加载](01-main-preload.md) | done | — | 可启动的空窗口 |
| 02 | [渲染进程与 IPC 契约](02-renderer-ipc.md) | active | 01 | 类型化 IPC 调用 |
```

步骤只写在子计划或单文件计划里，格式为 `- [ ] T<n> <动作> — 验证：<命令或可观察结果>`：

- `[ ]` 未完成，`[x]` 已完成，`[-]` 放弃。放弃时必须写明 `放弃：<原因>`。
- 编号在本文件内唯一，插入新步骤时取新编号，不重排已有编号，方便提交和进度引用。

## 6. 写作约束

- **自包含**：新会话只读计划和链接的笔记，就能继续工作。写清真实的文件路径、命令和前置环境，不写「如上所述」「按之前讨论」。
- **代码路径用反引号**：源码、配置等仓库文件写成 `src/main/index.ts`，不用 Markdown 链接。Markdown 链接只用于计划、笔记和外部网址。计划是当时的执行记录，代码之后可能改名或删除。`done`/`dropped` 计划只校验指向计划与笔记的链接，进行中的计划校验全部相对链接。
- **可验证**：每个目标和步骤都有可观察的完成条件。`## 验证` 先写预期，执行后补实际命令与结果；未执行的验证不写成已通过。
- **不复述理由**：`## 目标` 引用笔记的问题与验收标准，不重抄备选与取舍。
- **偏差上浮**：执行中发现的意外记入 `## 发现与偏差`。仅影响步骤的，就地调整计划；改变了决定或核心理由的，按笔记规则更新事实或另开笔记，计划只写摘要和链接。
- **进度只增不改**：`## 进度` 用 `- yyyy-mm-dd：<完成了什么、提交或证据>` 追加。其他章节保持当前事实，不写流水账。
- **交接写现状**：`## 交接` 只描述当前停在哪、下一步做什么、有什么未提交或未验证的内容；完成后写「无」。
- 提交信息可加可选尾注 `Plan: .agents/plans/...`，路径相对仓库根目录，与 `Note:` 并列。

## 7. 操作流

1. 检索已有计划，避免重复：`rg --hidden "<关键词>" .agents/plans/`。
2. 从本 Skill 的 `templates/` 复制模板：
   - 单文件计划用 `single.md`；
   - 父子计划用 `parent.md` + `child.md`。
3. 先写父计划，确定拆分与依赖，再逐个写子计划。评审阶段子计划可以只写目标、前置条件和粗粒度步骤。
4. 施工时同步：勾选步骤、追加进度、更新父计划表的状态、填写交接。
5. 写完或改完运行 `npm run verify-plans`；提交前运行 `npm run verify`，它会同时运行笔记校验和计划校验。

完整示例见 `examples/`：其中 `examples/plans/` 为计划，`examples/notes/` 为配套的示意笔记。校验命令：

```sh
node .agents/skills/todo-plan/scripts/verify-plans.mjs --plans .agents/skills/todo-plan/examples/plans --notes .agents/skills/todo-plan/examples/notes
```

示例内容为虚构场景，不代表项目已有实现。

## 8. 脚本边界

`verify-plans` 只检查机械约束：路径形态、头块、状态取值、必备章节顺序、步骤语法、父子表一致性、依赖顺序、状态约束和相对链接是否存在（`done`/`dropped` 计划仅检查指向计划与笔记的链接）。拆分是否合理、验证是否真实、交接能否接手，需要人工评审。
