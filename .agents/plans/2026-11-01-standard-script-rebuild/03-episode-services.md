# Plan: 剧集服务、事务保存与项目数据接线

Status: draft
Parent: plan.md

## 目标

交付 R01、R03—R05、R09、R14 的服务闭环：剧集唯一落在项目 SQLite，读取时聚合最新项目元信息；所有剧本写入与设定关联事务一致；项目树、页面所属剧集和删除语义不悬空。

## 前置条件

- 01、02 完成，并提供新契约、项目库访问／关闭接口。
- 阅读 `apps/engine/src/modules/scripts/{episodes.service,episodes.controller,scripts.module}.ts`、`apps/engine/src/modules/projects/{projects.service,projects.controller,project-files.service,project-store}.ts` 和 `packages/contracts/src/projects.ts`。
- 使用 `rg -n 'manifest\.episodes|\.episodes|episodeId|readManifest|EpisodeSummary' apps/engine/src/modules/projects apps/engine/src/modules/scripts apps/desktop/src/renderer/src/features/projects apps/desktop/src/renderer/src/lib` 盘点，不只改 episodes 服务。

## 步骤

- [ ] T1 将剧集创建、列表、更新、删除、脚本读取改成项目库，沿用现有 URL 和鉴权；相同项目内集号唯一，跨项目可相同 — 验证：E01；旧脚本 JSON 不再写出，新清单不写 episodes。
- [ ] T2 以 API 聚合项目响应向项目树／页面选择提供数据库剧集；拆开磁盘 `readManifest` 和业务 `readProject`，修复页面创建／修改时的 episodeId 存在性检查 — 验证：E02；磁盘清单仍只保存页面的归属，不复制剧集列表。
- [ ] T3 读取标准文档时注入最新项目名、genres／画风和剧集号／标题／时长，保存只处理允许编辑的正文／钩子／冲突字段；对企图提交只读字段的请求明确拒绝或按契约验证后投影，不反向修改权威源 — 验证：E03，项目与剧集表无意外变化；冲突行为和前端保持一致。
- [ ] T4 实现内部场／内容 ID、排序和场号投影：普通编辑沿用 ID，新增生成 ID，移场／移行不换 ID，重导入可全量换新；排序变更在事务内完成 — 验证：E04，旧位置链接仍定位同一内容而非同一数组下标。
- [ ] T5 重写文档保存，并在本阶段实现最小名称／别名精确匹配与人物／地点关联同步核心：校验、revision 检查、正文、元素／关系、统计及 revision 增长同一事务；使用 01 的设定契约，不等待 05 的资料管理 UI — 验证：E05、E06；无空同步占位，05 扩展改名／合并／忽略等管理行为时复用该事务核心，不能另起独立提交。
- [ ] T6 将剧集更新与文档上下文冲突接入：改集号即时影响所有场号且正文 ID 不变；元信息更新不能被正在解析的旧快照回写；项目 profile／名称变化触发读取刷新 — 验证：E03、E07；不逐行改场号落盘。
- [ ] T7 正常删除新剧集沿用既有「所属页面未分集、剧本保留 30 天回收」承诺，在项目库中用删除时间／归档行实现，不恢复旧 JSON；过期清理仅作用这类数据 — 验证：E08；这是新剧集正常删除，不等同 02 对旧回收永久清理，不增加恢复 UI。
- [ ] T8 对跨清单／数据库的正常删集解除页面归属设计幂等处理；若清单更新失败，返回失败并保证再次调用可收束，禁止页面指向已不可读取的活动集而无修复路径 — 验证：E08 的清单写失败／重启用例；记录实际写入顺序和修复入口。
- [ ] T9 替换旧 mtime/size/digest 剧本检查和 repair 摘要的调用，新剧本用 SQLite revision；画布的文件摘要冲突保护保持原样 — 验证：E06，普通画布 `readPage/writePage` 行为未改变，旧调用者清单归零。
- [ ] T10 补 API 错误码、事件和 Query 所需统计，排队／运行期间按现有任务互斥策略拒绝冲突保存；并发请求只允许一份基准 revision 成功 — 验证：E05、E07，冲突不覆盖另一个窗口的文字。

### 服务验收矩阵

| 编号 | 输入／操作                                                               | 预期                                                                  |
| ---- | ------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| E01  | 创建两集、重复集号、更新标题／时长，重启再读                             | ID／字段持久，重复集号 409；时间戳和排序正确，空剧本可读取。          |
| E02  | 创建／编辑创作页指定有效／无效／其他项目 episodeId，读取项目聚合响应     | 仅本项目活动剧集有效；页面保存原有 JSON 格式；树和剧集列表一致。      |
| E03  | 导入后修改项目名、genres、画风及剧集号／标题／时长，再保存一个旧页面草稿 | 最新权威值生效；旧草稿不能回滚这些值；核心冲突／钩子可正常保存。      |
| E04  | 添加、删除、移动场次与内容，保存三轮，再重启                             | 场号连续正确，已有 ID 稳定；删除后引用变为不存在而不误定位另一行。    |
| E05  | 保存中在正文、设定、关系、revision 各阶段注入故障                        | 所有行及 revision 回到提交前，不能出现正文成功但设定失败。            |
| E06  | 两请求同基准 revision；二次保存未修改文档；非法 ID 跨集复用              | 并发至多一个成功；不意外重复建元素；跨集篡改拒绝。                    |
| E07  | 转换期间保存／删集／改元信息／取消后迟到结果                             | 根据契约阻止或冲突；迟到结果不应用，不新增设定；元信息不被回写。      |
| E08  | 删除活动集，清单写失败后重试、重启；清理 30 天过期剧集                   | 页面保留且解除归属；无旧 JSON；未到期回收记录保留，其他回收不受影响。 |
| E09  | 升级后访问旧 episodeId，或已删除内容的出现位置链接                       | 明确不存在，可回项目列表；不自动创建剧集／替换为第一集。              |

## 验证

重写并定向运行 `apps/engine/src/modules/scripts/episodes.integration.test.ts`。项目聚合与页面归属用例优先加入 `projects.integration.test.ts`／`project-content.integration.test.ts` 并用 testNamePattern 限定本次新增命名，或者集中为 `episode-project.integration.test.ts`，最终记录实际采用位置。

```powershell
pnpm --filter @frame-loom/engine... build
pnpm --filter @frame-loom/engine exec vitest run src/modules/scripts/episodes.integration.test.ts
pnpm --filter @frame-loom/engine exec vitest run src/modules/projects/episode-project.integration.test.ts
```

新文件若未采用，必须替换为真实文件和 `-t` 用例名；不能运行空集合。项目库其他资产／上传测试无须全跑。实际：未执行。

## 进度

- 2026-11-01：编写服务和页面归属闭环、并发／故障案例；尚未实施。

## 发现与偏差

- `ProjectsService.validateEpisode` 当前检查 manifest.episodes，必须随服务切换，不能只改 UI。
- SQLite 内正文／关联可以原子提交；删除剧集还要变更清单里的页面归属，不能混称为同一个数据库事务。
- 保留旧新剧集正常删除的 30 天回收承诺，但不新增本次未请求的恢复界面。

## 交接

等待 01、02。完成时交付可运行的最小设定同步事务、API 路径／类型和修复顺序给 04、05 与前端。05 负责进一步的资料、改名、合并、忽略与孤立清理，不反向作为 03 的完成前置。
