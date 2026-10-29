# Plan: 集成验收与收尾

Status: done
Parent: plan.md

## 目标

本子计划用一条桌面 e2e 证明「新建项目 → 剧集 → 导入 → 编辑 → 设定库 → 重启」整条链路可用，同时完成以下工作：在构建产物的 CSP 下验证编辑器、模拟输入法组字和拖动；用模拟文本模型截取转换进度的截图；检查明暗主题和 720×560 窗口的截图；记录性能数字；执行一次全仓门禁；把两篇笔记移入 `implemented/`，同步相关笔记和文档，并把父子计划转为 `done`。

## 前置条件

- 07、08、09 已完成。
- 已阅读 `e2e/project-library.test.ts`（临时目录、模拟 `dialog.showOpenDialog`、主题切换与截图），以及 `e2e/model-service.fixture.ts`（`engineApi`、`addMediaChannel`）。
- 执行 e2e 前先运行 `pnpm --filter @frame-loom/engine... build && pnpm --filter @frame-loom/desktop build`。

## 步骤

- [x] T1 新建 `e2e/scripts.test.ts`，主流程走规则路径，不配置文本模型：
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
- [x] T2 在同一个测试文件中新增第二条用例「编辑器在生产 CSP 下的输入法组字与拖动」：
  - 用 `page.context().newCDPSession(page)` 发送 `Input.imeSetComposition`（内容「你好」），再发送 `Input.insertText`；断言当前段落的文字包含「你好」，并且段落数不变；
  - 拖动一个段落的手柄到另一个段落之后，断言大纲中场的人物或段落顺序发生了变化；
  - 断言没有 CSP 错误。

  — 验证：同上一步的命令，2/2 通过。真实输入法下「组字时按 Enter 不拆段」的人工检查结果，引用 06 的记录。
- [x] T3 截图（只拍这些，保存到 `.cache/scripts/`，不提交）：明暗两种模式下，各截以下 5 张：
  - 带项目设定展开的新建项目对话框；
  - 剧集列表；
  - 转换进行中的剧本页；
  - 带存疑段落和元素栏的编辑器；
  - 设定库 Tab 加抽屉。

  另外，在 720×560 窗口下截剧本页和剧集列表各 1 张。

  转换进行中的截图使用本地模拟的文本模型：用 `addMediaChannel` 创建渠道，用 `engineApi` 以 `openai-chat` 协议添加一个文本模型，再通过 `PUT /model-defaults` 设为默认文本模型；模拟服务器的 `/v1/chat/completions` 路由挂起响应，直到截图完成。

  逐张查看截图，检查以下几点：颜色都来自 token；文字没有被截断或溢出；焦点环可见；`document.documentElement.scrollWidth` 不超过 `innerWidth`。

  — 验证：截图文件已生成，查看结论和发现的问题记入本计划，问题修复后重新截图。
- [x] T4 性能数字（只记录，不作为门禁）：
  - 用 `parseScriptText` 把样例剧本复制成大约 3000 段，通过 `PUT` 写入一集；
  - 在 e2e 中记录从路由跳转到编辑器可编辑的时间；
  - 连续输入 50 个字符，用 `performance.now()` 记录每次按键的平均耗时。

  — 验证：两个数字写进本计划的「验证」一节。如果每次按键超过 16ms，记入「发现与偏差」，并按编辑器笔记的「Consequences」一节处理（由原 Risks 迁入）。
- [x] T5 全仓门禁，只执行这一次：依次运行 `pnpm run typecheck`、`pnpm run lint`、`pnpm run format:check`、`pnpm test`，以及受本需求影响的 e2e：
  - `e2e/scripts.test.ts`
  - `e2e/project-library.test.ts`
  - `e2e/project-tags.test.ts`
  - `e2e/canvas-shell.test.ts`
  - `e2e/panorama.test.ts`
  - `e2e/canvas-persistence.test.ts`
  - `e2e/project-assets.test.ts`

  `canvas-persistence` 和 `project-assets` 用于覆盖 fixture 的改动和 fullBleed 的改动。不运行生成、模型、视频、音频、图片编辑等无关的 e2e。

  — 验证：以上命令全部通过，实际输出的统计数字记入「验证」一节。
- [x] T6 收尾，在同一次提交中完成：
  - 两篇笔记按笔记规则改写为现在时，移入 `implemented/feature/` 和 `implemented/architecture/`，并把 Acceptance criteria 和 Risks 折进 Consequences；
  - 在[项目库](../../notes/implemented/feature/2026-10-26-project-library.md)中原地同步清单字段、目录、Tab、侧栏、页面请求体和回收区这些事实，并加上互链；
  - 在[主题与外壳](../../notes/implemented/feature/2026-10-24-theme-and-app-shell.md)中同步 fullBleed 的路由；
  - 更新 `AGENTS.md` 中「当前仓库包含…」这句的现状描述，以及 README 的功能说明；
  - 把父计划和各子计划的 `Note:` 改为指向新路径，并全部转为 `done`。

  — 验证：`pnpm run verify` 通过；检索两篇笔记原 proposed 路径无残留引用。

## 验证

- 预期：T1、T2 的 e2e 通过；T3 的截图已逐张查看；T4 的数字已记录；T5 全部通过；T6 后 `pnpm run verify` 通过。不调用真实模型。
- 构建：`pnpm --filter @frame-loom/engine... build`、`pnpm --filter @frame-loom/desktop build` 通过。
- 全仓：`pnpm run typecheck`、`pnpm run lint`、`pnpm run format:check` 通过。lint 首轮发现测试类型问题，修复后全仓复查通过；格式问题已修复。后续编辑器修复再次通过 desktop typecheck 与相关文件 eslint。
- 单元与集成：`pnpm test` 通过，contracts 283、canvas 163、desktop 283、engine 296，共 1025 项；后续新增和修复的剧本目录定向测试最新为 9 文件 70 项，全部通过。
- 桌面：T5 列出的 7 个 e2e 文件共 9 条用例全部通过（`.cache/scripts-regression.log`）；修复宽屏折叠、最小窗口截图等待与明亮骨架后，剧本两条 e2e 再次通过（`.cache/scripts-e2e-final.log`）。主流程在右栏合并小林；重启后剧本与别名保留。无 pageerror 或 CSP 错误。
- 截图：`new-project-{light,dark}`、`episodes-{light,dark}`、`conversion-{light,dark}`、`editor-{light,dark}`、`story-{light,dark}`、`episodes-720`、`editor-720` 共 12 张均已生成并逐张查看；最终修复后重看受影响截图。颜色复用 token；表单与抽屉纵向滚动，窄窗口剧集表格在容器内横向滚动，根文档均无横向溢出。名称输入框焦点环清晰，720 窗口可见更多菜单。
- 性能：3000 段、50 字，验收轮加载 **526ms**；每次 `keyboard.insertText` 的自动化往返平均 **97.51ms**；浏览器从 beforeinput 到 input 后微任务的平均 **18.97ms**。输入法修复后的最终回归轮分别为 **3183ms**、**106.31ms**、**22.20ms**，加载和自动化往返波动较大。后者不包括完整绘制，前者包括 CDP 往返，二者不能混用。数字保存在 `.cache/scripts/performance.json`，不作为门禁或流畅度达标承诺。
- T2 的自动化与人工部分均已通过。用户首次真实中文输入法检查发现组字回车拆段，修复事件层 `isComposing` / `229` 保护后，剧本目录 70 项测试、desktop typecheck 和定向 eslint 通过；用户在本会话明确反馈「未产生额外段落」，人工复验通过。Computer Use 两次无法激活窗口，人工证据来自用户反馈，未以 CDP 模拟替代。

## 进度

- 2026-10-29：创建子计划草稿。
- 2026-10-29：完成开发、自动化与 12 张截图验收；真实输入法人工结果仍待补齐，暂不移动笔记或把总计划标为完成。
- 2026-10-29：用户反馈真实输入法验收失败，补齐原生事件层和人物补全的组字保护与四项回归测试，保持 T2、T6 未完成。
- 2026-10-29：输入法修复后 desktop 构建及剧本 e2e 2/2 再次通过（`.cache/scripts-ime-e2e.log`），无 pageerror 或 CSP 错误。此次 3000 段测量加载 3183ms，自动化往返均值 106.31ms，浏览器输入处理均值 22.20ms；与前轮相比存在波动，保留性能风险。
- 2026-10-29：用户确认真实输入法组字回车不产生额外段落，T2 完成。两篇笔记移入 implemented，相关链接和父子计划状态同步，T6 完成；收尾运行 verify、改动文档格式检查与 diff 检查。

## 发现与偏差

- 性能仍超过 16ms。已按编辑器笔记先优化装饰：元素高亮仅重算改段，场景徽标复用 mapping；另把元素出现位置合为一轮扫描，缓存未变化的大纲行并只在场 id 列表变化时重绑观察器。固定 3000 段的后一次浏览器输入处理均值由 33.47ms 降为 18.98ms，自动化往返由 101.53ms 降为 59.81ms；机器负载与采样方式会影响数字，仍保留大文档输入延迟风险。
- 手柄最初受菜单触发器阻止原生拖动；拆开拖动按钮与菜单锚点，并限制选区工具条只响应文字选区，避免遮住落点。生产拖放验收通过。
- 保存后剧集查询失效必须 exact；返回路由不复用陈旧剧本缓存，外部响应只在 revision 前进且无待保存编辑时重置。否则可能回退 revision 或把旧文档当成新编辑。
- README、AGENTS、项目库与主题外壳笔记已同步；真实输入法复验通过后，两篇笔记已移入 implemented，并完成链接修复与父子计划关闭。

## 交接

无。
