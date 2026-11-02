# Plan: 标准契约、权威字段与验证样例

Status: done
Parent: plan.md

## 目标

交付 R04—R06、R09—R13 所需的共享契约和确定性样例，明确标准 JSON、内部编辑身份、磁盘清单和项目聚合响应的边界。模型协议、存储和 UI 都消费这一份契约，不能各写近似 schema。

## 前置条件

- 阅读父计划和主笔记，Node.js 24.22.x、pnpm 12.15.0；先运行 `node --version`、`pnpm --version`，只记录实际结果。
- 读取 `packages/contracts/src/scripts.ts`、`projects.ts`、`desktop.ts`、`events.ts`、`endpoints.ts`、`index.ts`、相关测试，以及 engine／desktop 的全部引用。
- 使用 `rg -n 'ScriptDocument|ScriptFile|ScriptBlock|parseScriptText|applyMarkdownEdit|renderScriptMarkdown|StoryFile|EpisodeSummary|ProjectManifest|scriptView|scriptMentions' packages apps` 建立受影响符号清单；记录本次修改的消费者，不顺手修改无关契约。

## 步骤

- [x] T1 在本文件追加「契约清单」，固定标准文档、内部 ID、保存请求、导入任务、设定属性、磁盘清单／聚合响应的字段表及真实代码位置 — 验证：每个消费者有唯一契约来源，表中不出现第二份可写正文或第三种 beat。
- [x] T2 在 `scripts.ts` 建立标准 `meta/scenes/beats` Zod 契约和内部编辑契约；模型不输出内部 ID，API 外层保留 revision 与任务信息；动作标记只标准化一次 — 验证：C01—C04 通过。
- [x] T3 在 `projects.ts` 区分磁盘清单和对外项目响应；支持新格式版本及旧格式升级入口，HTTP 项目响应可带数据库聚合的剧集但新清单写入不带 episodes；项目 profile 新增画风，类型复用 genres；剧集加入 duration_sec — 验证：C05、C06 通过，不把 genre 和 genres 做成两处独立可编辑值。
- [x] T4 定义人物、地点的类别化 attrs，保留 prop／costume 和 ignored 行为；定义改名、合并与稳定出现位置的结果契约 — 验证：分类字段、唯一命名和稳定定位 schema 用例通过。
- [x] T5 定义短文完整输出与长文边界／场次片段输出的内部 schema：来源编号、负责区间、上下文区间、续场身份、不可表示内容和批次身份；状态区分定位、解析、校验、应用及最终状态 — 验证：协议边界、未知类型和来源映射负例通过；标准 JSON 不含模型来源映射。
- [x] T6 定义只读元信息投影和场号生成的共享函数；集号改变、移场、插场不改内部 ID — 验证：契约与 engine 集成测试断言最新权威投影、自动场号及内部 ID 稳定。
- [x] T7 编写短样例原文／标准 JSON 和配套预期／来源映射；长样例由 `packages/contracts/fixtures/standard-script-long.mjs` 固定生成器生成，生成器只生成数据不模拟解析器 — 验证：短样例可逐句核对，长样例至少跨三批且含超长单场、重复句和边界对白；保留只在旧升级测试中需要的旧格式 fixture。长文不另存静态 `.md`，避免重复维护。
- [x] T8 定义移除剧本偏好的兼容过滤：仅过滤既有 scriptView／scriptMentions 后校验新偏好 — 验证：C07 保留主题与路径并过滤旧键。
- [x] T9 清理 `index.ts` 等出口并删除旧 contracts parser／Markdown 源码 — 验证：contracts build、typecheck、静态旧路径扫描通过。

### 契约清单

实施位置为 `packages/contracts/src/scripts.ts`、`script-import-protocol.ts`、`projects.ts` 和 `desktop.ts`：

| 契约                                       | 字段／边界                                               | 消费者                                                |
| ------------------------------------------ | -------------------------------------------------------- | ----------------------------------------------------- |
| `ScriptDocument`                           | 严格 meta/scenes/beats，仅 action/dialogue，不含内部身份 | 模型最终文档、导出投影、契约测试                      |
| `EditableScriptDocument`                   | 场和内容增加程序生成的 id，元信息读取时投影              | engine 剧集保存、desktop Tiptap、保存通道             |
| `ScriptResult` / `ScriptSaveRequest`       | 外层 revision、任务信息；唯一可写正文为 document         | episodes controller、Query、script-page               |
| `ProjectManifest` / `ProjectDiskManifest`  | HTTP 聚合 episodes／新磁盘格式禁止 episodes              | projects service、local store、desktop 主进程与项目树 |
| `StoryElement`                             | 分类 attrs、manuallyEdited；精确名称命名空间             | story service、关联事务、设定抽屉                     |
| `ImportBoundaryBatch` / `ImportSceneBatch` | 负责区间、上下文区间、续场键与来源映射                   | 模型编排、保真验证与 mock 测试                        |
| `readDesktopPreferences`                   | 仅过滤 scriptView/scriptMentions，然后 strict 校验       | 主进程 preferences                                    |

受影响消费者已以 rg 盘点：contracts 的旧 parser/Markdown 和测试；engine 的 project-store、local-project-store、projects、episodes、story、conversion；desktop 的 project-files、profile、episodes、script 全 feature、story 抽屉、Query 和 preferences。events/endpoints 的既有事件与 URL 无需改变。

### 必要样例与预期

| 编号 | 输入／行为                                                                                 | 预期                                                            |
| ---- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| C01  | 笔记标准 JSON、空 emotion、空可编辑文字、0 时长                                            | 接受；显示时长未填写；空草稿与导入非空要求分开。                |
| C02  | sound／production／note、blocks、preface、duration_text、非法 time_of_day、非布尔 interior | 拒绝，不能 passthrough 成功后静默丢字段。                       |
| C03  | dialogue 缺 speaker／line，action 带 dialogue 专属字段，负／小数秒、重复内部 ID            | 结构拒绝；允许的空草稿不等同缺字段。                            |
| C04  | 动作分别带零个／一个／多个开头 △，连续三次读写                                             | 结果只有一个展示标记；正文不反复裁剪，台词标点不改写。          |
| C05  | 项目题材与画风改变；剧集标题、集号、时长改变                                               | 所有读取与编辑器使用最新权威值，不保留旧 meta 副本。            |
| C06  | 旧清单有 episodes；新清单有持久化 episodes；HTTP 聚合响应有 episodes                       | 旧清单进入升级；新磁盘写入拒绝双写；HTTP 响应允许聚合。         |
| C07  | 旧偏好同时带 dark、projectLocation、scriptView=markdown、scriptMentions=true               | 新偏好保留 dark 和路径，只丢弃已删除功能键，不整体回到 system。 |
| C08  | 第 2 集 A/B/C 三场，移动 C 到首位，再改成第 5 集                                           | 场号依次 2-1/2-2/2-3 → 5-1/5-2/5-3；场／内容内部 ID 一直不变。  |

短样例使用自编内容：项目「夜班便利店」、人物「林夏／西装男」、同地点昼夜复用；一名人物只在动作出现，一名说话人不在原出场名单。另一个项目同名人物必须独立。预期文本逐字写出，不调用待测解析器生成 expected。

## 验证

执行时优先沿用现有测试文件；新增用例可使用 `src/scripts.test.ts`、`src/projects.test.ts`、`src/desktop.test.ts` 和拟新增 `src/script-import-protocol.test.ts`。若更名，同批修改这里和 08，不能用不存在文件得到空测试通过。

```powershell
pnpm --filter @frame-loom/contracts build
pnpm --filter @frame-loom/contracts typecheck
pnpm --filter @frame-loom/contracts exec vitest run src/scripts.test.ts src/projects.test.ts src/desktop.test.ts src/script-import-protocol.test.ts
```

只需跑上述被改契约测试及 C01—C08；若实际改 events／endpoints 行为，补对应文件用例。不跑图像、音视频、画布几何等无关契约。

实际：contracts build、typecheck 与 `src/scripts.test.ts src/projects.test.ts src/desktop.test.ts src/script-import-protocol.test.ts` 通过，共 69 tests。长文样例采用 `.mjs` 固定数据生成器，不保存重复静态长文文件。

## 进度

- 2026-11-01：编写契约、消费者盘点与确定性样例要求，尚未实施。
- 2026-11-01：开始实施，Node v24.22.1、pnpm 12.15.0；完成直接消费者盘点和契约边界表。
- 2026-11-02：C01—C08 与 69 项 contracts 定向测试通过；项目清单／聚合契约、短 fixture 与长文生成器均已核对，T1—T9 完成。

## 发现与偏差

- 旧 `ProjectManifest` 同时用作磁盘和 HTTP 数据；必须拆清楚，不能去掉 episodes 后让现有项目树与页面归属检查空掉。
- 模型判断清晨／黄昏或前言附录不属于扩充新 schema 的授权；无法表达的实质内容由导入失败定位，不隐式映射成新类型。

## 交接

01 契约与其所属测试完成；目录版 N02 已通过，整体仍待 08 的真实模型、原生 IME 和原型同缩放视觉对照。
