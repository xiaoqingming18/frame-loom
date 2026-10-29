# Plan: 集成验收与收尾

Status: draft
Parent: plan.md

## 目标

本子计划用一条桌面 e2e 证明「新建项目 → 剧集 → 导入 → 编辑 → 设定库 → 重启」整条链路可用，同时完成以下工作：在构建产物的 CSP 下验证编辑器、模拟输入法组字和拖动；用模拟文本模型截取转换进度的截图；检查明暗主题和 720×560 窗口的截图；记录性能数字；执行一次全仓门禁；把两篇笔记移入 `implemented/`，同步相关笔记和文档，并把父子计划转为 `done`。

## 前置条件

- 07、08、09 已完成。
- 已阅读 `e2e/project-library.test.ts`（临时目录、模拟 `dialog.showOpenDialog`、主题切换与截图），以及 `e2e/model-service.fixture.ts`（`engineApi`、`addMediaChannel`）。
- 执行 e2e 前先运行 `pnpm --filter @frame-loom/engine... build && pnpm --filter @frame-loom/desktop build`。

## 步骤

- [ ] T1 新建 `e2e/scripts.test.ts`，主流程走规则路径，不配置文本模型：
  1. 新建项目「剧本验收」，不展开项目设定；
  2. 在剧集 Tab 新建剧集，默认集号为 1，标题填「重逢」，确认后进入剧本页；
  3. 点击「粘贴整集剧本」，在文本框中填入 `packages/contracts/fixtures/script-sample-01.txt` 的内容，确认出现黄色的设定提示条；选择「短剧」「真人实拍」和「悬疑」，点击「开始转换」；
  4. 等待结果提示的文字为「已识别 7 场、60 段，新增 10 个待确认元素」；
  5. 点击「周屿 你这几年还好吗」段落的「存疑」徽标，选择「改为对白（角色：周屿）」；
  6. 在文末新建一个段落，输入「1-8 夜 外 天台」后按 Enter，大纲中出现 1-8；
  7. 在「小林啊，别想了，睡吧。」这个段落上选中「小林」，点击「标记为人物」，然后在右栏把「小林」合并到「林夏」；
  8. 切换到设定库 Tab，确认人物数量为 4 个，「林夏」的别名中包含「小林」；
  9. 打开「林夏」的抽屉，点击一条出现位置，跳回剧本页，并确认对应段落可见；
  10. 关闭应用，用同一个用户数据目录重新启动，剧本、设定库和侧栏中的剧集都保留。

  测试全程收集 `pageerror` 和控制台中的 CSP 错误，最后断言两者都为空。

  — 验证：`pnpm --filter @frame-loom/desktop exec playwright test e2e/scripts.test.ts` 通过，1/1。
- [ ] T2 在同一个测试文件中新增第二条用例「编辑器在生产 CSP 下的输入法组字与拖动」：
  - 用 `page.context().newCDPSession(page)` 发送 `Input.imeSetComposition`（内容「你好」），再发送 `Input.insertText`；断言当前段落的文字包含「你好」，并且段落数不变；
  - 拖动一个段落的手柄到另一个段落之后，断言大纲中场的人物或段落顺序发生了变化；
  - 断言没有 CSP 错误。

  — 验证：同上一步的命令，2/2 通过。真实输入法下「组字时按 Enter 不拆段」的人工检查结果，引用 06 的记录。
- [ ] T3 截图（只拍这些，保存到 `.cache/scripts/`，不提交）：明暗两种模式下，各截以下 5 张：
  - 带项目设定展开的新建项目对话框；
  - 剧集列表；
  - 转换进行中的剧本页；
  - 带存疑段落和元素栏的编辑器；
  - 设定库 Tab 加抽屉。

  另外，在 720×560 窗口下截剧本页和剧集列表各 1 张。

  转换进行中的截图使用本地模拟的文本模型：用 `addMediaChannel` 创建渠道，用 `engineApi` 以 `openai-chat` 协议添加一个文本模型，再通过 `PUT /model-defaults` 设为默认文本模型；模拟服务器的 `/v1/chat/completions` 路由挂起响应，直到截图完成。

  逐张查看截图，检查以下几点：颜色都来自 token；文字没有被截断或溢出；焦点环可见；`document.documentElement.scrollWidth` 不超过 `innerWidth`。

  — 验证：截图文件已生成，查看结论和发现的问题记入本计划，问题修复后重新截图。
- [ ] T4 性能数字（只记录，不作为门禁）：
  - 用 `parseScriptText` 把样例剧本复制成大约 3000 段，通过 `PUT` 写入一集；
  - 在 e2e 中记录从路由跳转到编辑器可编辑的时间；
  - 连续输入 50 个字符，用 `performance.now()` 记录每次按键的平均耗时。

  — 验证：两个数字写进本计划的「验证」一节。如果每次按键超过 16ms，记入「发现与偏差」，并按编辑器笔记的「Risks」一节处理。
- [ ] T5 全仓门禁，只执行这一次：依次运行 `pnpm run typecheck`、`pnpm run lint`、`pnpm run format:check`、`pnpm test`，以及受本需求影响的 e2e：
  - `e2e/scripts.test.ts`
  - `e2e/project-library.test.ts`
  - `e2e/project-tags.test.ts`
  - `e2e/canvas-shell.test.ts`
  - `e2e/panorama.test.ts`
  - `e2e/canvas-persistence.test.ts`
  - `e2e/project-assets.test.ts`

  `canvas-persistence` 和 `project-assets` 用于覆盖 fixture 的改动和 fullBleed 的改动。不运行生成、模型、视频、音频、图片编辑等无关的 e2e。

  — 验证：以上命令全部通过，实际输出的统计数字记入「验证」一节。
- [ ] T6 收尾，在同一次提交中完成：
  - 两篇笔记按笔记规则改写为现在时，移入 `implemented/feature/` 和 `implemented/architecture/`，并把 Acceptance criteria 和 Risks 折进 Consequences；
  - 在[项目库](../../notes/implemented/feature/2026-10-26-project-library.md)中原地同步清单字段、目录、Tab、侧栏、页面请求体和回收区这些事实，并加上互链；
  - 在[主题与外壳](../../notes/implemented/feature/2026-10-24-theme-and-app-shell.md)中同步 fullBleed 的路由；
  - 更新 `AGENTS.md` 中「当前仓库包含…」这句的现状描述，以及 README 的功能说明；
  - 把父计划和各子计划的 `Note:` 改为指向新路径，并全部转为 `done`。

  — 验证：`pnpm run verify` 通过；`rg "proposed/feature/2026-10-29-episodes|proposed/architecture/2026-10-29-script-editor" .agents docs AGENTS.md README.md` 没有结果。

## 验证

- 预期：T1、T2 的 e2e 通过；T3 的截图已逐张查看；T4 的数字已记录；T5 全部通过；T6 后 `pnpm run verify` 通过。不调用真实模型。
- 实际：未执行。

## 进度

- 2026-10-29：创建子计划草稿。

## 发现与偏差

无。

## 交接

依赖 07、08、09，尚未开始。
