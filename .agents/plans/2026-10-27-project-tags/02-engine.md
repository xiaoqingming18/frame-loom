# Plan: engine 标签接口

Status: draft
Parent: plan.md

## 目标

engine 提供标签的增删改查和引用扫描。删除接口按改派列表改写未打开的页面，引用清空后才移除标签。

## 前置条件

- 01 完成。

## 步骤

- [ ] T1 新建项目时在 `apps/engine/src/modules/projects/projects.service.ts` 写出内置 `tags` — 验证：集成测试读取新项目清单
- [ ] T2 新增 `apps/engine/src/modules/projects/project-tags.service.ts` 与控制器路由（`GET/POST /projects/:id/tags`、`PATCH /projects/:id/tags/:tagId`）；全部操作在 `store.serial(id)` 内执行；报错 `TAG_NAME_CONFLICT`、`TAG_LIMIT_EXCEEDED`、`TAG_NOT_FOUND`、`TAG_BUILTIN_READONLY` — 验证：集成测试覆盖增改查、内置标签不能编辑、旧清单无 `tags` 时首次写入后补齐
- [ ] T3 实现 `GET /projects/:id/tags/:tagId/usages`：逐页读取页面文件，返回页面名、节点标题、类型、锁定状态和缩略图哈希；页面不可读时报错，不能当作「无引用」 — 验证：集成测试覆盖两个页面的引用
- [ ] T4 实现 `POST /projects/:id/tags/:tagId/delete`：
  - 按 `reassign` 改写页面，只修改 `tagId` 仍等于被删标签的节点，锁定节点照常修改，revision 加 1，并修复清单摘要。
  - 重新扫描；仍有引用时返回 409 `TAG_IN_USE` 并附带最新引用。
  - 没有引用时移除标签。
  - 改派目标必须存在，且不等于被删标签。

  — 验证：集成测试覆盖改派后 revision 递增、锁定节点被改派、遗漏引用返回 409、改派目标无效返回 400、清单写入失败时页面已迁移且重试成功
- [ ] T5 运行 engine 全量测试 — 验证：`pnpm --filter @frame-loom/engine test`、`typecheck`

## 验证

- 预期：engine 集成测试、typecheck、lint 通过。
- 实际：未执行。

## 进度

- 2026-10-27：创建子计划草稿。

## 发现与偏差

无。

## 交接

尚未开始，等待 01。
