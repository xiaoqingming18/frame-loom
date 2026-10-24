# 实施计划使用指南

决策笔记记录「为什么、放弃了什么」，实施计划记录「怎么做、做到哪、怎么证明」。计划位于 `.agents/plans/`，由项目自有的 [todo-plan 技能](../.agents/skills/todo-plan/SKILL.md)定义规则。计划通过 `Note:` 单向链接到笔记；笔记不依赖计划。

## 什么时候写

满足任一条时写计划：

- 跨多次提交或多个会话；
- 有序步骤超过一屏；
- 大型需求需要拆成可独立验收的子任务。

单次提交能完成的改动、纯机械改动和单纯的取舍记录不写计划。非平凡改动仍须先写或更新决策笔记，见[决策笔记指南](decision-notes.md)。

## 形态与目录

```text
.agents/plans/
  2026-11-10-settings-store.md      # 单文件计划
  2026-11-02-media-pipeline/        # 大型需求：父子计划
    plan.md                         # 父计划：目标、拆分、依赖、汇总验收
    01-ffmpeg-binding.md            # 子计划：可独立验收的一段工作
    02-render-task-queue.md
```

- 名称 `yyyy-mm-dd-topic`，日期为首次创建日；topic 使用小写字母、数字与短横线。
- 层级上限两层：父计划 + 同级子计划，禁止孙计划。子计划过大时拆成更多同级子计划，或提升为独立父计划。
- 子计划编号表示建议顺序，依赖只能指向更小的编号。
- 生命周期写在 `Status:` 中，不靠目录表示；计划完成后原地保留，不移动、不删除。

## 与决策笔记联动

| 阶段 | 笔记 | 计划 |
| --- | --- | --- |
| 评审 | `proposed/` | `draft`，与笔记同批评审 |
| 施工 | `proposed/` | `active`；勾选步骤、追加进度、同步父计划表 |
| 阻塞 | 不变 | `blocked — <原因>` |
| 收尾 | 移入 `implemented/` | 同一次提交更新 `Note:` 路径并转 `done` |
| 放弃 | 转 `rejected/` 或删除 | `dropped — <原因>` |

执行中发现需要改变决定或核心理由时，按笔记规则更新笔记或另开笔记；计划只在 `## 发现与偏差` 中写摘要和链接。

## 文件格式

头块固定：

```markdown
# Plan: <标题>

Status: active
Note: ../notes/proposed/process/2026-11-10-settings-store.md
```

子计划使用 `Parent: plan.md`，`Note:` 可选；父计划与单文件计划至少一行 `Note:`。没有对应笔记时写 `Note: 无 — <原因>`。必备章节、子计划表、步骤语法和写作约束见[技能契约](../.agents/skills/todo-plan/SKILL.md)，模板在 `.agents/skills/todo-plan/templates/`，完整虚构示例在 `.agents/skills/todo-plan/examples/`。

提交信息可加可选尾注 `Plan: .agents/plans/...`，与 `Note:` 并列，见 [Git 提交信息规范](git-commit-convention.md)。

## 校验

```sh
npm run verify-plans   # 计划路径、头块、状态、章节、步骤、父子一致性与链接（done/dropped 仅查计划与笔记链接）
npm run test:plans     # 校验器正反例，以及自带示例的合规检查
npm run verify         # 提交前运行：笔记校验 + 计划校验
```

脚本只检查机械约束。拆分是否合理、验证是否真实执行、交接能否接手，仍需人工评审。
