# Plan: 页面导入保存、权威字段接线与旧链路移除

Status: draft
Parent: plan.md

## 目标

将 03—06 接成完整桌面流程，满足 R04—R10、R14：页面工具栏只有重新导入／保存，最新项目／剧集信息只读投影，长文任务和可靠保存可操作，所有被替代旧入口从生产路径删除。

## 前置条件

- 03—06 核心能力和定向测试可用；本阶段不是用 UI 空壳占位模型／数据库。
- 阅读 `apps/desktop/src/renderer/src/features/projects/script/{script-page,script-persistence,import-dialog,conversion-banner}.tsx/ts`、`features/projects/{profile-fields,profile,project-dialog,project-detail,project-tree}`、`episodes/episode-dialog.tsx`、`lib/project-queries.ts`、剧本路由及 `apps/desktop/src/main/preferences.ts`。
- 读取 `packages/contracts/src/desktop.ts` 和 preferences 主进程测试。strict schema 的兼容过滤先于删键，不可使用户主题与路径一同丢失。

## 步骤

- [ ] T1 改项目设定表单的画风和剧集表单的单集时长，复用 genres 显示类型；项目名作为剧名，不另设同义可写字段；新旧项目缺省可编辑 — 验证：I01，修改后所有打开剧本立即使用最新投影值。
- [ ] T2 页面工具栏只显示重新导入／保存，状态使用非操作文本；删除 Markdown／样式 Tabs、大纲开关、元素面板／标记、类型菜单、导出、帮助等旧入口 — 验证：I02，限定工具栏 role 的按钮集合精确为两个，不误删编辑区场／行按钮和应用公共导航。
- [ ] T3 重新导入打开原文弹窗，展示当前权威项目／剧集信息和使用的文本模型；未配置模型明确禁用／报错，不再提示规则识别或强制补无关 profile 字段 — 验证：I03，输入不会被模型回复或弹窗关闭意外覆盖。
- [ ] T4 有有效剧本时明确确认替换；有未保存草稿时先完成保存／保留处理；运行中只读或按服务互斥，状态区／弹窗提供取消、错误定位和失败批重试，不增加第三个页面工具按钮 — 验证：I04，失败／取消后有效剧本仍在，原文可重试。
- [ ] T5 接入定位／解析／校验／应用各阶段、真实批数及最终结果；不伪造百分比；离开页面任务可继续，重开读取持久状态，重启中断后不自动付费 — 验证：I05，与 04 的状态及取消事件一致，不在前端自行把超时写成成功。
- [ ] T6 更新保存协调器：自动保存与手动保存串行，Ctrl+S 同入口；相同 revision 不能同时提交，输入法组字结束后才取快照；请求期间继续输入要保留后续脏稿 — 验证：I06，旧响应不能把新输入标为已保存。
- [ ] T7 接入保存失败／冲突／退出保护：显示可理解错误、保留草稿、重试最新文档；409 不静默 reload 覆盖；离开／关闭前沿用未保存保护 — 验证：I06、I07，不发明工具栏导出／复制全本按钮解决冲突。
- [ ] T8 接入项目／剧集／设定 Query 失效、项目树和稳定出现位置路由；旧已清除 episodeId 返回项目列表导航，定位已删除内容说明不存在 — 验证：I01、I08；不回退到数组相同下标或自动新建集。
- [ ] T9 在 preferences 读入口过滤旧 scriptView／scriptMentions，删除新 schema／写入口和 renderer 的旧偏好消费；保留其他合法偏好 — 验证：I09，旧 dark＋路径＋Markdown 偏好打开后主题和路径仍在。
- [ ] T10 盘点并删除旧 parser／Markdown／旧节点、菜单、装饰、元素栏及相应不可达文件、导出和测试；保留仍被新功能使用的公共 pure helper — 验证：I10，每个残留匹配说明真实用途，不用空导出兼容死代码。
- [ ] T11 检查新数据库服务模块接线、项目关闭／移除／系统回收顺序；只修改因新库直接受影响的 host 入口 — 验证：单元／集成用例和 08 实机一致，无循环依赖、无重复连接、无对画布内核的改动。
- [ ] T12 更新必要用户文案、设计差异说明和当前项目背景；完成前不能声称真实模型／视觉／安装验收通过 — 验证：文案不存在规则兜底、Markdown 双向、预估时长或旧版本读 v2 等已失效说明；历史完成计划保留原历史。

### 桌面集成矩阵

| 编号 | 操作／状态                                                        | 预期                                                                       |
| ---- | ----------------------------------------------------------------- | -------------------------------------------------------------------------- |
| I01  | 项目设定改 genre／style／名称，剧集改集号／标题／时长             | 只读编辑器、项目树和列表一致；旧草稿保存不回滚元信息；场号更新而 ID 不变。 |
| I02  | 展开页面、聚焦行、打开窄屏大纲                                    | 工具栏按钮恰为重新导入／保存；场／行操作还在；无旧面板／标签页。           |
| I03  | 无模型、模型禁用、空原文、重复点击导入                            | 明确说明文本模型要求；不创建重复任务、不规则识别；原文不丢。               |
| I04  | 首次导入、二次导入确认、已有脏稿、取消、坏 JSON                   | 有效文档在失败前后不变；成功只替换一次；设定计数正确。                     |
| I05  | 长文切页再回、关进程重开、失败后重试                              | 阶段和批数真实；成功批可复用；重开不自动发模型请求。                       |
| I06  | 自动保存与保存按钮／Ctrl+S 同时触发，期间继续输入，首请求慢／失败 | 请求串行、后续文字仍脏；最终保存最新文字；失败输入保留。                   |
| I07  | 409、离开页面、关闭窗口、组合输入期间保存                         | 不强制覆盖或丢稿；组合字不落半字；错误可恢复。                             |
| I08  | 设定出现位置点击，移场后再点击，已删除位置、旧剧集 URL            | 对准稳定 ID；无效位置明确说明；公共导航正常。                              |
| I09  | 读取旧偏好文件再保存主题，重启                                    | 只清旧剧本偏好，其他偏好保持；不创建 localStorage 第二份设置。             |
| I10  | 静态扫描旧关键字和符号、访问已删除旧路由／组件                    | 无生产旧入口；升级 fixture 和历史文档可保留旧词且有说明。                  |

### 残留审计命令

```powershell
rg -n 'parseScriptText|applyMarkdownEdit|renderScriptMarkdown|ScriptBlock|scriptView|scriptMentions|preface|appendix|guess|decisions' packages/contracts/src apps/engine/src/modules/scripts apps/desktop/src/renderer/src/features/projects/script apps/desktop/src/main/preferences.ts
rg -n 'Markdown|元素栏|元素标记|段落类型|预估时长|时长预估|仅按规则|规则识别' apps/desktop/src/renderer/src/features/projects/script
```

记录每个残留为「仍使用的公共能力」「明确旧格式清理／测试」「应删除」；不以零匹配机械替代语义判断，不能搜索整个 docs 后删除历史记录。`ScriptDocument` 等名称可沿用，但语义必须是新结构。

## 验证

```powershell
pnpm --filter @frame-loom/contracts build
pnpm --filter @frame-loom/desktop exec vitest run --project renderer src/renderer/src/features/projects/script src/renderer/src/features/projects/story
pnpm --filter @frame-loom/desktop exec vitest run --project node src/main/preferences.test.ts
pnpm --filter @frame-loom/desktop typecheck
```

补跑实际修改的 profile／episode 表单测试及项目树读聚合数据的最小用例，不默认跑整个项目库和 renderer。最终 e2e、视觉和实机统一在 08。实际：未执行。

## 进度

- 2026-11-01：编写页面接线、保存竞争与删除审计矩阵；尚未实施。

## 发现与偏差

- 页面工具栏限制不包括导入弹窗的确认／取消、任务取消／重试、编辑区的场／行操作；测试必须限定容器而不是数整页所有按钮。
- 保留自动保存和显式保存共用同一通道，不建立两套 revision；任何状态文字不能冒充保存按钮之外的新业务入口。

## 交接

等待 03—06。完成后把实际变更文件清单、已运行测试及未完成缺口交给 08；不要在本阶段用全仓测试掩盖未写针对性的边界用例。
