# Plan: 定向测试、真实模型、视觉与实机验收

Status: active
Parent: plan.md

## 目标

以最小必要集合证明 A01—A08 和 R01—R15，无遗漏且不测试无关功能。所有证据区分自动 mock、真实模型、浏览器模拟、Windows 原生操作与目录版运行，不能互相替代。

## 前置条件

- 01—07 已完成其实施和所属定向测试；父表与子文件状态一致，无未说明的功能偏差。
- 读取最终 diff／新增文件，确认调用者清单和本计划命令的文件名仍真实存在。未跟踪新文件也必须纳入，不只看 git diff --stat。
- 自动测试全部使用独立临时目录与测试 userData，不对用户真实项目做清理、删除或替换；真实语料使用自编 fixtures 或用户明确允许的源文。
- 证据目录统一为忽略的 `.cache/standard-script-rebuild/`，其中 acceptance.md、用例结果、必要 JSON／截图不含模型凭据。长期可复现输入和测试代码放仓库 fixtures／test 文件，不仅留缓存。

## 步骤

- [x] T1 按最终变更面填写本文件「实际测试选择与证据」，将每个 R／A 编号对应到真实测试文件、命令与结果；区分需要补跑和已有可复用证据 — 验证：R01—R15、A01—A08 无空项，未改模块无多余全套任务。
- [x] T2 合并执行必要 contracts／engine／desktop 单测与类型检查、定向 lint／format、文档校验；失败先修根因，修后只复跑失败项和受影响项 — 验证：每个命令有测试数量和退出码，不使用 --passWithNoTests，不把编译通过当功能测试。
- [x] T3 改写 `apps/desktop/e2e/scripts.test.ts`，使用本地 mock 文本模型经过真实任务／数据库／编辑器链路；短文成功、长文分批／失败、设定资料、旧项目清理／重开等用例分开 — 验证：下表 F01—F04；不依赖旧规则 parser 生成预期或预置最终文档绕过模型编排。
- [x] T4 对项目清理跑完整故障阶段矩阵 P02—P06，人工核对一次哨兵文件哈希和实际保留路径；成功后新建数据再重启证明不二次清理 — 验证：A01，有清理路径清单、前后哈希和中断恢复结果；不触及真实项目。
- [ ] T5 建立同数据视觉参考，执行明亮／暗色、宽屏／窄屏截图和尺寸断言，逐张查看差异并修复 — 验证：V01—V04；仅批准差异保留，不能只保存截图不看。同缩放原型渲染对照仍缺，应用截图与尺寸断言已通过。
- [ ] T6 使用一个已配置且可用的真实文本模型，导入自编短样例与跨批长样例；记录模型 ID、输入长度、容量、定位／解析／重试次数、总耗时和逐场校对结果 — 验证：L01、L02，不得把 mock 成功写成真实模型成功；没有环境时记录待验收，不勾完成。
- [ ] T7 使用真实 Windows 中文输入法验证候选确认、组字／保存、撤销、场／行按钮焦点；保留自动 composition 用例证据 — 验证：N01，分别记录真实 IME 和自动模拟，不用 CDP 结果代替真实输入法。
- [x] T8 生成加固目录版并只做本次必要启动、导入／保存、退出、关闭后移动项目、重新定位与再次保存烟测 — 验证：N02，数据库句柄释放，项目可携带；不执行完整 NSIS 安装／卸载或无关产品回归。
- [x] T9 完成静态旧路径审计、diff 范围审计、实际测试证据与风险说明，检查测试未通过删除断言／跳过用例来规避需求 — 验证：无 Markdown／旧解析兜底等可达入口，所有已知失败有处理结论。
- [ ] T10 同步主笔记为 implemented，记录真实 Testing／Consequences、更新旧笔记事实和互链、必要时用归档脚本封存完整被替代篇；更新 AGENTS.md 和设计说明的当前事实，父／子计划全部 done 并修正 Note 路径 — 验证：全部验收已完成且无未勾步骤，`pnpm run verify` 和改动文档格式检查通过；尚有真实验收缺口时本步骤不得勾选。

### 自动 e2e 最小流程

| 编号 | 流程                                                                                           | 必须观察的结果                                                                                          |
| ---- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| F01  | 建项目并设题材／画风，建集并设时长 → 短文模型导入 → 修改对白／钩子 → 插场移场 → 保存重启       | 工具栏恰两个操作，权威项只读，场号自动、内部 ID 持久，标准 JSON 与 UI 一致，页面无 CSP／console error。 |
| F02  | 已有有效文档 → 小容量配置触发多批和单场拆片 → 失败第二批 → 重试 → 成功；另测取消及坏结构       | 只重试必要批，失败／取消正文和设定不变；成功一次原子替换，无漏重；状态与批数真实。                      |
| F03  | 两集同地点／人物别名 → 设定库完善全部人物／地点字段 → 改名／合并 → 删除引用 → 道具服装各建一条 | 去重、资料保护、出现位置、别名与跨集引用正确；不触发无关素材生成。                                      |
| F04  | 构造旧格式临时项目＋画布／资产哨兵 → 打开升级 → 新建新集／设定 → 重启 → 关闭并移动 → 重新定位  | 旧域清空、页面未分集，其余字节不变；新数据不二次清空，ID 和设定随项目移动。                             |

可在 engine 测试覆盖的故障不全部复制成 e2e，F02 只取一个代表性失败和取消，F04 只取完整成功链。升级中断／SQL 回滚等深入组合由 P／E／M 矩阵承担。

### 视觉验收

| 编号 | 条件                                                   | 比对／证据                                                                                                         |
| ---- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| V01  | 明亮，窗口 1600×900，应用内容区宽度固定，系统缩放 100% | 对齐原型大纲 258、doc 720 上限、字体／行高／padding、元信息／场标题／行工具／结尾；同 fixture 截图，记录允许差异。 |
| V02  | 暗色，同 V01                                           | 相同结构与尺寸，token 正确，角色名、弱文字、焦点、hover、删除和错误可辨。                                          |
| V03  | 编辑区域宽分别在 900／820 断点两侧及窗口 720×560       | 正确进入紧凑／折叠大纲；折叠定位、键盘焦点、工具按钮不溢出；无横向整页滚动。                                       |
| V04  | 空场／空 emotion／长地点名／多人物／保存失败／导入状态 | 占位、换行、焦点和状态真实；emotion 空值展示遵循参考，不制造虚假情绪。                                             |

参考文件如无法按工具安全策略预览，不绕过限制；可继续静态尺寸核对及应用截图，并明确参考渲染比对待完成。不能在未取得参考画面时写「像素一致」。截图比较裁剪编辑区域，排除应用外壳的批准差异；布局关键尺寸用 DOM／computed style 断言，字体抗锯齿不要求位图逐像素完全相同。

### 真实模型和原生验收

| 编号 | 输入／操作                                                                                              | 合格标准                                                                                                               |
| ---- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| L01  | 自编短样例，含动作独有人物、漏填名单 speaker、空 emotion、原文元信息与项目不一致                        | 动作／台词／顺序逐句一致；只读元信息用项目；自动设定完整且不覆盖资料。                                                 |
| L02  | 自编长样例至少约 3 万字或明显超过当前所选模型一次输出预算，并包含超长单场；强制实际至少三次内容解析调用 | 每个来源区间覆盖一次，重复句保留正确次数，场次续接正确，无漏句／改词；记录真实耗时、调用数和人工校对，不用只看总场数。 |
| N01  | Windows 原生 IME 连续输入中文、候选 Enter、组字时 Ctrl+S、撤销重做、移场后继续输入                      | 无额外空行、半字保存、光标跳失或字段串写；保存重开文本完整。                                                           |
| N02  | 新目录版＋独立 userData，创建／保存项目、退出后移动文件夹并重新定位，再保存退出                         | 项目库随行，SQLite 可打开写入，所有句柄关闭；console／engine 无本次错误。                                              |

L02 若自动保真校验拒绝模型输出，应记录失败并修复分批／提示／校验中的实际问题；不能放松校验来让测试通过。如果模型本身不满足要求，说明具体证据与剩余风险，请用户决定更换模型或改变产品要求，不能擅自改成标签解析或缩短样例。

## 验证

### 必要命令与运行规则

以下均从仓库根目录运行；拟新增文件按实施实际名称同步。先检查测试列表真实匹配，再执行。contracts 构建为 engine／desktop 共享输出前置；engine 的 test 脚本会触发构建，定向运行改用 exec vitest，避免每个文件重复构建。

```powershell
pnpm --filter @frame-loom/contracts build
pnpm --filter @frame-loom/contracts typecheck
pnpm --filter @frame-loom/engine typecheck
pnpm --filter @frame-loom/desktop typecheck
pnpm --filter @frame-loom/contracts exec vitest run src/scripts.test.ts src/projects.test.ts src/desktop.test.ts src/script-import-protocol.test.ts
pnpm --filter @frame-loom/engine... build
pnpm --filter @frame-loom/engine exec vitest run src/modules/projects/project-script-database.test.ts src/modules/projects/script-upgrade.integration.test.ts src/modules/projects/episode-project.integration.test.ts src/modules/scripts/episodes.integration.test.ts src/modules/scripts/conversion.integration.test.ts src/modules/scripts/script-source-validation.test.ts src/modules/scripts/story.integration.test.ts --testTimeout=30000
pnpm --filter @frame-loom/engine exec vitest run src/modules/llm/llm-complete.test.ts src/modules/projects/local-project-store.test.ts --testTimeout=30000 --silent
pnpm --filter @frame-loom/desktop exec vitest run --project renderer src/renderer/src/features/projects/script src/renderer/src/features/projects/story
pnpm --filter @frame-loom/desktop exec vitest run --project node src/main/preferences.test.ts
pnpm --filter @frame-loom/desktop build
pnpm --filter @frame-loom/desktop exec playwright test e2e/scripts.test.ts
pnpm exec tsx apps/desktop/e2e/script-packaged.smoke.ts
pnpm run verify
```

此外只补：实际改动的 profile／episode 表单、项目树聚合读取、LLM 本次调用选项、必要的项目生命周期／main 文件测试。若 events／endpoints 行为变更，同步补这些 contracts 测试。不跑整个 `pnpm test`、所有 e2e、canvas 几何、音视频协议或对象存储测试。

ESLint 使用 `pnpm exec eslint` 加实际改动 TS／TSX／MJS 路径，Prettier 使用 `pnpm exec prettier --check` 加实际改动源文件；改动 Markdown 以 `--ignore-path .gitignore` 显式纳入被默认忽略的笔记／计划。路径列表必须同时包含新增文件，不触及技能上游原文、归档封印和 `docs/design/juben.html`。若生成路由文件，按仓库既有生成约定处理，不手改生成内容。

目录版仅在最终源码稳定后构建一次，沿用 `pnpm --filter @frame-loom/desktop package:dir`；它会运行既有 package:prepare 和必要构建，但不等于执行无关测试。若实际改动项目库生命周期之后才修复，重建目录版并只复验 N02。不要执行 package:win 或发布。

目录版烟测默认读取 `apps/desktop/release/win-unpacked/Frame Loom.exe`，可用 `FRAME_LOOM_PACKAGED_EXE` 指向明确构建物。脚本使用独立临时 userData 和项目、正常关闭两次并在退出后两次移动项目，保持生产 fuses 不变。Electron 模型端是本地 mock，不能将 N02 计入真实模型 L01/L02。

开发版 F01—F04、目录版 N02 和原生 IME 验收必须串行：独立 userData 不能隔离 Windows 前台焦点。F01 在输入前断言编辑器已解除任务只读并聚焦测试窗口；等待真实状态，不增加盲目重试或延时。

### 实际测试选择与证据

已执行的自动化与人工证据如下；未通过或未执行项保留在表末，不能将 mock／浏览器模拟冒充真实验收：

| 项目                               | 实际内容                                                                                                                                                                                                                                                         |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 最终变更与测试文件清单             | contracts、engine scripts/projects、desktop renderer/main、`apps/desktop/e2e/scripts.test.ts` 及新增 SQLite／协议／fixture 文件均纳入；旧 parser、Markdown、旧节点文件物理删除。                                                                                 |
| 自动命令／退出码／用例数／结果路径 | contracts 69 项；SQLite／升级定向 14 项；engine 合并最终集合 48 项；renderer 25 项；main 30 项；三包 typecheck、contracts build、定向 ESLint/Prettier、`pnpm run verify` 均退出码 0；开发版 Electron F01—F04 通过。                                              |
| P／E／M／S／U／I 与 R／A 覆盖对应  | P01—P11，E01—E09，M01—M12 的主要异常／保真矩阵，S01—S12 核心路径，U01—U10、I01—I10 均有自动用例或静态／截图证据；N02 补齐 Windows 目录版关闭后文件移动。原生输入仍缺。                                                                                           |
| 视觉截图与逐张结论                 | `.cache/standard-script-rebuild/editor-{light,dark}-1600.png`、四张 901/899/821/819 断点图、720 窄屏、1280 边界图已逐张查看；CSS 关键值 doc 720px、outline 258px、title 25px、padding 56/40/240。125% 系统缩放；原型 file 预览被安全策略拒绝，不能声称像素一致。 |
| 真实模型 L01／L02                  | 未执行：检查到本机配置库没有默认可用 chat 模型。开发版 mock 只验证编排／来源校验／UI，不代表真实模型保真。                                                                                                                                                       |
| 原生 IME 与目录版 N01／N02         | N01 未执行：`@oai/sky` 工具和运行包不可用。N02 已通过 `script-packaged.smoke.ts`；证据为 `.cache/standard-script-rebuild/packaged-acceptance.json` 和 `packaged-{before,after}-move.png`。                                                                       |
| 未执行项目与原因                   | 真实模型、原生中文 IME、同缩放原型渲染对照未完成；完整 NSIS 安装／卸载按本计划非目标未执行。所有破坏性升级测试仅用临时项目。                                                                                                                                     |

| R／A              | 证据位置与实际结果                                                                                                                                                          |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R01—R03；A01、A02 | `project-script-database.test.ts`、`script-upgrade.integration.test.ts`、`episode-project.integration.test.ts`（engine 最终 48 项集合）；F04 和 N02 项目移动／重定位通过。  |
| R04—R06、R09；A03 | contracts 的 `scripts.test.ts`、`projects.test.ts`、`desktop.test.ts`、`script-import-protocol.test.ts` 共 69 项；`episodes.integration.test.ts` 和 F01 验证权威字段与 ID。 |
| R07—R09；A06      | script renderer／commands 定向用例、F01 明暗／断点／状态截图及 `editor-sizes.json`；真实 IME 和同缩放参考渲染尚缺，A06 未全部通过。                                         |
| R10、R14；A04     | `conversion.integration.test.ts`、`script-source-validation.test.ts`、`llm-complete.test.ts`、F02；分批／保真负例和取消／故障 mock 通过，L01/L02 未执行，A04 未全部通过。   |
| R11—R13；A05、A07 | `story.integration.test.ts` 4 项、`story.test.tsx` 5 项和 F03，资料、关联和四类管理通过。                                                                                   |
| R15；A08          | 变更文件限定 ESLint／Prettier、三包 typecheck、69/48/25/30 项定向集合、F01—F04、N02；真实模型、IME 和同缩放视觉仍缺，A08 未通过。                                           |

engine 的 LLM 有界调用／本地项目存储另补 2 文件 8 项通过，与合并集合 48 项无重叠，合计 56 项。开发版最后一次合并执行的 F02—F04 通过；F01 修正前台焦点、主题模拟状态和空字段辅助换行后定向复跑通过，不把有失败的合并日志写成整次退出码 0。日志集中在 `.cache/standard-script-rebuild/logs/`，`final-f01.log` 为最新 F01 结果。

本机汇总证据为 `.cache/standard-script-rebuild/acceptance.md`。最终源码的目录包已重建；首轮 N02 提交导入请求触发应用五秒 HTTP 超时，`final-packaged.log` 保留失败。补充无凭据请求时序诊断后，同一构建物全流程复跑通过，见 `final-packaged-diagnostic.log` 与最新 `packaged-acceptance.json`；没有修改生产超时或 fuses。首次超时底层原因尚未确认，仍保留偶发风险。烟测每次开始清除旧成功 JSON，失败另存诊断，不复用过期结果。

## 进度

- 2026-11-01：编写定向测试选择、端到端／视觉／真实模型／原生验收要求；未执行产品验证。
- 2026-11-02：contracts 69 项、SQLite／升级 14 项、conversion 19 项、episodes 4 项、story 4 项、renderer 25 项、main 30 项及三包 typecheck/build/verify 通过；开发版 Electron F01—F04 通过。F01 新增 V04 边界已复跑通过。真实模型、原生 IME、原型同缩放对照和目录版运行仍未通过。
- 2026-11-02：engine 最终合并 7 文件 48 项通过；新增目录版独立烟测脚本，确认原启动超时为 Playwright 主进程调试与生产 fuse 不兼容。保持加固配置正常启动后 N02 全流程通过，退出后两次移动项目成功。剩余 T5、T6、T7、T10 保持未完成。

- 2026-11-02：最终视觉复查发现 V04 沿用前轮的模拟暗色状态，已分别设置系统主题和媒体模拟并等待真实生效；空情绪行因 ProseMirror 辅助换行拆行，已保留空字段光标盒并隐藏辅助换行。F01 验证清空后可再次输入、明暗同行位置和截图，最新定向复跑通过；F02—F04 沿用通过证据。
- 2026-11-02：最终源码目录包重建完成；N02 首轮五秒 HTTP 超时后保留失败，加入请求时序失败诊断，同一构建物复跑通过。最终 ESLint 65 文件、Prettier 85 文件、desktop typecheck、`pnpm run verify`（35 notes／122 plans）与 `git diff --check` 均退出码 0；汇总写入缓存验收报告。三项真实验收条件仍缺，不提前归档。

## 发现与偏差

- 本次用户明确允许跳过无关测试，优先级高于旧计划的全仓门禁；不得复制旧 06-acceptance 的全仓命令。
- 目录包第一次构建因 Electron 下载超时，使用本机 Electron 45.0.0 缓存后生成成功；初次驱动使用 `_electron.launch` 与关闭主进程 inspect fuse 冲突，改用正常启动及临时本机渲染端口后 N02 通过，未放宽生产加固。真实模型、原生 IME 和同缩放原型渲染对照缺失，因此不能将本计划／父计划标 done，也不能把主笔记转成 implemented。

## 交接

01—07 开发与所属定向验证完成，自动 e2e 和加固目录版 N02 已通过。剩余：提供可用默认文本模型后执行 L01/L02；具备原生桌面输入工具或人工参与后执行 N01；在获准且同缩放的预览环境完成 V01—V04 原型渲染对照。08 与父计划保持 active，主笔记保持 proposed，A04/A06/A08 尚未全部通过。所有修改未提交，未推送。
