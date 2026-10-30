# Plan: 集成验收与收尾

Status: draft
Parent: plan.md

## 目标

本子计划完成以下工作：

- 用 e2e 证明导入真实格式的剧本、Markdown 双向编辑和偏好记忆整条链路可用；
- 更新原有的剧本 e2e；
- 检查截图；
- 记录完整《影娘》剧本的导入结果；
- 执行一次全仓门禁；
- 把笔记移入 `implemented/`，在原剧集笔记和编辑器选型笔记中补上互链并同步事实，父子计划转为 `done`。

## 前置条件

- 03、05 已完成。
- 已运行 `pnpm --filter @frame-loom/engine... build && pnpm --filter @frame-loom/desktop build`。
- 已阅读 `apps/desktop/e2e/scripts.test.ts` 现有的写法。

## 步骤

- [ ] T1 更新原有的剧本 e2e：
  - 结果提示的预期改为「已识别 7 场、60 段，新增 10 个元素」；
  - 用到「幕」类型的操作（如果有），改为大纲中的插入分幕；
  - 依赖元素下划线的步骤，先打开「元素标记」，或者先在元素栏中选中元素。

  — 验证：`pnpm --filter @frame-loom/desktop exec playwright test e2e/scripts.test.ts` 中原有的用例全部通过。
- [ ] T2 新增 e2e 用例「真实格式剧本与 Markdown 视图」，不配置文本模型：
  1. 新建项目和剧集，粘贴 `packages/contracts/fixtures/script-sample-02.txt` 的内容，补填项目设定后转换；
  2. 断言结果提示为「已识别 6 场、67 段，新增 24 个元素」；
  3. 前言卡片可以展开，内容包含「一句话梗概」；
  4. 大纲中有 6 场，第 1 场显示「清晨」；
  5. 切换到 Markdown 页签，把「我不是妖怪。」改为「我不是妖怪，我是你。」。然后在第 5 个场标题行（「卢宅正屋 — 夜（蒙太奇）」那一行；Markdown 视图按顺序重新编号，所以这一行显示为 `**5.`）之前，插入一行 `**5. 内景　卢宅正屋 — 雨夜**`、一个空行和一行动作，等待保存完成；
  6. 切回样式视图，大纲中有 7 场；通过 `engineApi` 读取剧本，确认被修改的对白段落 id 与修改前相同；
  7. 再切到 Markdown 视图后重启应用，进入剧本页时直接显示 Markdown 视图。

  测试全程收集 `pageerror` 和 CSP 错误，最后断言两者都为空。

  — 验证：`pnpm --filter @frame-loom/desktop exec playwright test e2e/scripts.test.ts` 全部通过。
- [ ] T3 截图，保存到 `.cache/scripts-fix/`，不提交：明暗两种模式下，各截一张样式视图（包含前言卡片、带 timecode 的场标题和 production 段落）和一张 Markdown 视图；再在 720×560 窗口下，截一张样式视图和一张 Markdown 视图。逐张检查以下几点：颜色都来自 token；没有文字溢出；焦点环可见；`scrollWidth` 不超过 `innerWidth`。

  — 验证：截图文件已生成，查看结论记入本计划。
- [ ] T4 记录完整《影娘》剧本的导入结果：在开发模式下，按纯规则导入 `D:\WorkSpace\project\personal\reference_files\影娘_剧本.md`，把各类型的数量与笔记验收第 5 条中的原型数字对照，记录差异及原因。这一项不作为门禁。如果用户已经配置了文本模型，可以再导入一次，记录调用次数和结果，并说明这次的结果没有经过人工校对。

  — 验证：数字和对照结论写进本计划的「验证」一节。
- [ ] T5 全仓门禁，只执行这一次：依次运行 `pnpm run typecheck`、`pnpm run lint`、`pnpm run format:check`、`pnpm test`，以及 `e2e/scripts.test.ts`、`e2e/project-library.test.ts` 这两个 e2e。不运行与剧本无关的 e2e。

  — 验证：全部通过，实际的统计数字记入「验证」一节。
- [ ] T6 收尾，在同一次提交中完成：
  - 笔记改写为现在时，移入 `implemented/feature/`；
  - 在[剧集与结构化剧本](../../notes/implemented/feature/2026-10-29-episodes-and-structured-scripts.md)中，规则表、「只对存疑行做决定」、原文完整性第 2 条、Tab 循环和元素高亮这几处加上指向新笔记的链接，并原地同步代码位置、段落类型表这些事实，不把原有的决定改写成相反的内容；
  - 在[编辑器选型](../../notes/implemented/architecture/2026-10-29-script-editor-tiptap.md)中补上互链；
  - 必要时更新 `AGENTS.md` 中「当前仓库包含…」这句的现状描述，以及 README；
  - 父计划和各子计划转为 `done`，`Note:` 改为指向新路径。

  — 验证：`pnpm run verify` 通过；`rg "proposed/feature/2026-10-30-script-import" .agents docs AGENTS.md README.md` 没有结果。

## 验证

- 预期：T1、T2 的 e2e 通过；T3 的截图已逐张查看；T4 已记录；T5 全部通过；T6 后 `pnpm run verify` 通过。不调用真实模型，T4 中可选的那一项除外。
- 实际：未执行。

## 进度

- 2026-10-30：创建子计划草稿。

## 发现与偏差

无。

## 交接

依赖 03、05，尚未开始。
