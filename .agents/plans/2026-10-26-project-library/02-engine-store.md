# Plan: 项目存储与生命周期

Status: draft
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

- [ ] T1 新增 schema 与迁移（`pnpm --filter @frame-loom/engine db:generate`），`app_meta` 的 `schema_version` 同步递增 — 验证：迁移在空库与已有 0005 的库上都能执行，重复执行幂等
- [ ] T2 实现原子写入、串行队列与重试 — 验证：单测模拟目标被占用后释放、持续占用超时返回 `PROJECT_WRITE_FAILED` 且原文件不变
- [ ] T3 实现新建：名称规则、库内唯一、同名文件夹报错、路径长度 200、非递归 `mkdir`、失败回滚 — 验证：集成测试逐项覆盖，失败后目录不存在
- [ ] T4 实现打开、作为副本打开、重新定位、可用性检查五种状态、重命名 — 验证：集成测试覆盖 id 未登记、已登记原路径不可用、已登记原路径可用、mismatch、too_new、损坏 JSON
- [ ] T5 实现页面增删改、读写、409 与外部修改检测、删除移入 `.frameloom/trash/pages/`、封面与 `updatedAt` 回写、视图保存 — 验证：集成测试覆盖 revision 冲突、外部改写后 revision 重新读取、封面选择最新图片、无图为 null
- [ ] T6 在 `AppModule` 注册 `ProjectsModule` — 验证：`pnpm --filter @frame-loom/engine test`、`pnpm --filter @frame-loom/engine typecheck`

## 验证

- 预期：engine 单测与集成测试（真实 SQLite、临时目录）通过，`db:generate` 无未提交变更。
- 实际：未执行。

## 进度

- 2026-10-26：创建子计划草稿。

## 发现与偏差

无。

## 交接

尚未开始；等待 01。
