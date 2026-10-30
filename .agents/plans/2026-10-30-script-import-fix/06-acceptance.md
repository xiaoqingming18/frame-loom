# Plan: 集成验收与收尾

Status: done
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

- [x] T1 更新原有的剧本 e2e：
  - 结果提示的预期改为「已识别 7 场、60 段，新增 10 个元素」；
  - 用到「幕」类型的操作（如果有），改为大纲中的插入分幕；
  - 依赖元素下划线的步骤，先打开「元素标记」，或者先在元素栏中选中元素。

  — 验证：`pnpm --filter @frame-loom/desktop exec playwright test e2e/scripts.test.ts` 中原有的用例全部通过。
- [x] T2 新增 e2e 用例「真实格式剧本与 Markdown 视图」，不配置文本模型：
  1. 新建项目和剧集，粘贴 `packages/contracts/fixtures/script-sample-02.txt` 的内容，补填项目设定后转换；
  2. 断言结果提示为「已识别 6 场、67 段，新增 24 个元素」；
  3. 前言卡片可以展开，内容包含「一句话梗概」；
  4. 大纲中有 6 场，第 1 场显示「清晨」；
  5. 切换到 Markdown 页签，把「我不是妖怪。」改为「我不是妖怪，我是你。」。然后在第 5 个场标题行（「卢宅正屋 — 夜（蒙太奇）」那一行；Markdown 视图按顺序重新编号，所以这一行显示为 `**5.`）之前，插入一行 `**5. 内景　卢宅正屋 — 雨夜**`、一个空行和一行动作，等待保存完成；
  6. 切回样式视图，大纲中有 7 场；通过 `engineApi` 读取剧本，确认被修改的对白段落 id 与修改前相同；
  7. 再切到 Markdown 视图后重启应用，进入剧本页时直接显示 Markdown 视图。

  测试全程收集 `pageerror` 和 CSP 错误，最后断言两者都为空。

  — 验证：`pnpm --filter @frame-loom/desktop exec playwright test e2e/scripts.test.ts` 全部通过。
- [x] T3 截图，保存到 `.cache/scripts-fix/`，不提交：明暗两种模式下，各截一张样式视图（包含前言卡片、带 timecode 的场标题和 production 段落）和一张 Markdown 视图；再在 720×560 窗口下，截一张样式视图和一张 Markdown 视图。逐张检查以下几点：颜色都来自 token；没有文字溢出；焦点环可见；`scrollWidth` 不超过 `innerWidth`。

  — 验证：截图文件已生成，查看结论记入本计划。
- [x] T4 记录完整《影娘》剧本的导入结果：在开发模式下，按纯规则导入 `D:\WorkSpace\project\personal\reference_files\影娘_剧本.md`，把各类型的数量与笔记验收第 5 条中的原型数字对照，记录差异及原因。这一项不作为门禁。如果用户已经配置了文本模型，可以再导入一次，记录调用次数和结果，并说明这次的结果没有经过人工校对。

  — 验证：数字和对照结论写进本计划的「验证」一节。
- [x] T5 全仓门禁，只执行这一次：依次运行 `pnpm run typecheck`、`pnpm run lint`、`pnpm run format:check`、`pnpm test`，以及 `e2e/scripts.test.ts`、`e2e/project-library.test.ts` 这两个 e2e。不运行与剧本无关的 e2e。

  — 验证：全部通过，实际的统计数字记入「验证」一节。
- [x] T6 收尾，在同一次提交中完成：
  - 笔记改写为现在时，移入 `implemented/feature/`；
  - 在[剧集与结构化剧本](../../notes/implemented/feature/2026-10-29-episodes-and-structured-scripts.md)中，规则表、「只对存疑行做决定」、原文完整性第 2 条、Tab 循环和元素高亮这几处加上指向新笔记的链接，并原地同步代码位置、段落类型表这些事实，不把原有的决定改写成相反的内容；
  - 在[编辑器选型](../../notes/implemented/architecture/2026-10-29-script-editor-tiptap.md)中补上互链；
  - 必要时更新 `AGENTS.md` 中「当前仓库包含…」这句的现状描述，以及 README；
  - 父计划和各子计划转为 `done`，`Note:` 改为指向新路径。

  — 验证：`pnpm run verify` 通过；检索旧提案路径无结果。

## 验证

- 预期：T1、T2 的 e2e 通过；T3 的截图已逐张查看；T4 已记录；T5 全部通过；T6 后 `pnpm run verify` 通过。不调用真实模型，T4 中可选的那一项除外。
- 实际：
  - 全仓 `pnpm run typecheck`、`pnpm run format:check` 通过。`pnpm run lint` 首次只报 contracts 两处问题，移除无 await 的 async 和未使用解构变量后，相关文件 eslint 通过；其余全仓文件未报错。
  - `pnpm test` 首次 contracts 322 通过、1 失败，修复后运行完成所有包：contracts 323、canvas 163、desktop 303、engine 300，共 1089 项通过。随后新增手工修正类型的连续保存回归，contracts 全部 324 项通过；再新增清空 Markdown 正文后撤销的组件回归，script-page 8 项通过（最终合计 1091 项）。后续仅重跑受影响的 contracts、剧本 renderer 与类型检查；renderer 完整定向轮 82 项通过，最后新增的 1 项随 script-page 8 项复验通过。最终 desktop typecheck、改动文件 eslint 与格式检查通过。
  - `playwright test e2e/scripts.test.ts e2e/project-library.test.ts` 首轮 3 通过、1 失败。旧用例在空 scene 中输入整行标题，不触发 action 的 Enter 自动识别；保留原 Ctrl+2 动作输入后，该用例单独重跑通过（1 项）。新增 Markdown、生产 CSP／IME／拖动与性能、项目库三项首轮均通过。最终构建后的 Markdown 复验发现小窗口大纲隐藏影响 role 定位，断言场数前恢复 1600×900 后再次通过（1 项，7.6s）。pageerror 与 CSP 收集均为空。3000 段加载 584ms，50 次输入自动化往返均值 63.28ms、输入事件处理均值 32.31ms，仍有大文档延迟风险，不作流畅度达标承诺。
  - `.cache/scripts-fix/sample-styled-light.png`、`sample-styled-dark.png`、`sample-markdown-light.png`、`sample-markdown-dark.png`、`sample-styled-720.png`、`sample-markdown-720.png` 已逐张查看：前言、时间码、制作提示可读；没有横向文字溢出；Markdown 焦点环可见；截图前均断言 `scrollWidth <= innerWidth`。小窗口大纲和元素栏按现有响应式规则折叠。颜色来源为语义 token 与 tag token。
  - 开发模式（5173）导入完整《影娘》：前言 0–46 行、附录从 831 行起，共 415 段、28 场、2 处存疑；scene 28、character 56、dialogue 69、parenthetical 14、production 36、sound 23、transition 8、text 2、note 9、action 170，与原型逐项一致，无数量差异。来源文件未入库。记录保存在 `.cache/scripts-fix/dev-results.json`。纯规则路径没有真实模型调用；没有对整篇内容逐句人工校对。
  - `pnpm run verify` 在笔记移动及链接更新后通过。没有新增依赖、改动 fixtures、主进程、CSP 或格式版本；没有执行安装包验收。

## 进度

- 2026-10-30：创建子计划草稿。
- 2026-10-30：完成开发与生产构建验收、截图、完整剧本记录、全仓检查和笔记收尾。

## 发现与偏差

- 同类型切换时，有 attrs 的结构段落保留已解析属性并清 review，普通正文仍按目标类型重解析，修复「△走」切成 action 应去掉标记的回归。
- 自动保存保留用户原文本；恢复行映射先用渲染行匹配稳定边界，再映射一行多段，避免手工修正类型与规则猜测不同导致后续保存错位。增加连续保存回归。
- 清空 Markdown 后保留编辑器实例，切回样式仍可一次撤销；保存失败重试仍走 Markdown 回写，冲突复制保留当前 Markdown 原文。
- 全仓测试初次在 contracts 失败而中止，因此修复后继续执行全仓测试完成尚未运行包；其后只定向复验相关改动。

## 交接

01–06 均完成，笔记已转 implemented。风险：旧应用不能读 v2，Markdown 大幅改写区域可能生成新 id；未调用真实模型、未重做打包验收。
