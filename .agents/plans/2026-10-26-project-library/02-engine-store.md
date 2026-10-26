# Plan: 项目存储与生命周期

Status: done
Parent: plan.md

## 目标

engine 新增 `apps/engine/src/modules/projects/`：

- `ProjectStore` 接口与 `LocalProjectStore` 实现：清单与页面的读写、原子写入（`.frameloom/tmp/` → fsync → rename，`EPERM`／`EBUSY` 退避重试最多 2 秒）、按项目 id 的串行写队列、revision／mtime／size 缓存与外部修改检测。
- `projects` 与 `page_views` 表的 Drizzle schema 与迁移；`generation_jobs` 新增可空 `project_id`、`page_id` 与索引。
- 接口：`GET /projects`（含可用性状态）、`POST /projects`（新建）、`POST /projects/open`（打开已有／作为副本）、`POST /projects/:id/relocate`、`PATCH /projects/:id`（重命名）、`DELETE /projects/:id`（仅删注册行，回收站由主进程执行）、`GET /projects/:id`（清单）、页面 `POST /projects/:id/pages`、`PATCH`／`DELETE /projects/:id/pages/:pageId`、`GET`／`PUT /projects/:id/pages/:pageId`（文档与 revision）、`PUT /projects/:id/pages/:pageId/view`。
- 页面保存后回写清单的 `updatedAt` 与 `coverSha256`（最新 `createdAt` 的图片版本）。

## 前置条件

- 01 完成，contracts 已构建。

## 步骤

- [x] T1 新增 schema 与迁移（`pnpm --filter @frame-loom/engine db:generate`），`app_meta` 的 `schema_version` 同步递增 — 验证：迁移在空库与已有 0005 的库上都能执行，重复执行幂等
- [x] T2 实现原子写入、串行队列与重试 — 验证：单测模拟目标被占用后释放、持续占用超时返回 `PROJECT_WRITE_FAILED` 且原文件不变
- [x] T3 实现新建：名称规则、库内唯一、同名文件夹报错、路径长度 200、非递归 `mkdir`、失败回滚 — 验证：集成测试逐项覆盖，失败后目录不存在
- [x] T4 实现打开、作为副本打开、重新定位、可用性检查五种状态、重命名 — 验证：集成测试覆盖 id 未登记、已登记原路径不可用、已登记原路径可用、mismatch、too_new、损坏 JSON
- [x] T5 实现页面增删改、读写、409 与外部修改检测、删除移入 `.frameloom/trash/pages/`、封面与 `updatedAt` 回写、视图保存 — 验证：集成测试覆盖 revision 冲突、外部改写后 revision 重新读取、封面选择最新图片、无图为 null
- [x] T6 在 `AppModule` 注册 `ProjectsModule` — 验证：`pnpm --filter @frame-loom/engine test`、`pnpm --filter @frame-loom/engine typecheck`

## 验证

- 预期：engine 单测与集成测试（真实 SQLite、临时目录）通过，`db:generate` 无未提交变更。
- 实际：`pnpm test` 中 engine 21 个文件、177 项通过；全仓 typecheck 与 lint 通过。项目新增 15 项存储／HTTP 集成测试；数据库测试覆盖空库、0005 升级与重复迁移。`pnpm --filter @frame-loom/engine db:generate` 再次执行报告无 schema 变更。

## 进度

- 2026-10-26：创建子计划草稿。
- 2026-10-26：01 构建完成后执行 T1–T6；新增 0006 迁移、ProjectsModule、文件存储与生命周期接口，真实 SQLite／临时目录测试通过。

## 发现与偏差

- 当前落盘 schema_version 为 1，因此 0006 更新为 2；不按迁移文件编号推断版本。不删除旧 `canvas_documents`，删除归属 08。
- 缓存 revision、mtime、size 与内容摘要；读取仍检查磁盘内容，避免同步软件保留 mtime/size 时拿到旧 revision。缓存不保存整份画布。
- 页面先落盘、清单后更新；下次读页面修复封面和时间。删除页面若清单写失败则将回收区文件移回。
- 系统回收站、项目媒体、生成任务归属写入和 30 天回收区清理仍由 03／05 承接；本轮只新增归属列，不宣称已接入任务流程。

## 交接

无。
