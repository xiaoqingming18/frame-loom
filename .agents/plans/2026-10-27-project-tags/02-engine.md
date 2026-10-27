# Plan: engine 标签接口

Status: done
Parent: plan.md

## 目标

engine 提供标签的增删改查和引用扫描。删除接口按改派列表改写未打开的页面，引用清空后才移除标签。

## 前置条件

- 01 完成。

## 步骤

- [x] T1 新建项目时在 `apps/engine/src/modules/projects/projects.service.ts` 写出内置 `tags` — 验证：集成测试读取新项目清单
- [x] T2 新增 `apps/engine/src/modules/projects/project-tags.service.ts` 与控制器路由（`GET/POST /projects/:id/tags`、`PATCH /projects/:id/tags/:tagId`）；全部操作在 `store.serial(id)` 内执行；报错 `TAG_NAME_CONFLICT`、`TAG_LIMIT_EXCEEDED`、`TAG_NOT_FOUND`、`TAG_BUILTIN_READONLY` — 验证：集成测试覆盖增改查、内置标签不能编辑、旧清单无 `tags` 时首次写入后补齐
- [x] T3 实现 `GET /projects/:id/tags/:tagId/usages`：逐页读取页面文件，返回页面名、节点标题、类型、锁定状态和缩略图哈希；页面不可读时报错，不能当作「无引用」 — 验证：集成测试覆盖两个页面的引用
- [x] T4 实现 `POST /projects/:id/tags/:tagId/delete`：按 `reassign` 改写仍引用待删除标签的节点，锁定节点照常修改并递增 revision；重扫引用，仍有引用返回附带详情的 409，引用清空后移除标签。
  — 验证：集成测试覆盖 revision、锁定节点、残留引用冲突、无效改派目标、清单写入失败后重试
- [x] T5 运行 engine 验证 — 验证：projects 集成测试、`pnpm --filter @frame-loom/engine typecheck`

## 验证

- 预期：engine 集成测试、typecheck、lint 通过。
- 实际：`pnpm --filter @frame-loom/engine test` 通过（28 个测试文件、228 项）；`pnpm --filter @frame-loom/engine typecheck`、变更文件 lint 和格式检查通过。

## 进度

- 2026-10-27：创建子计划草稿。
- 2026-10-27：实现项目标签接口、跨页引用扫描和改派删除；集成覆盖旧清单、锁定节点、失败重试。

## 发现与偏差

- `TAG_IN_USE` 的最新引用通过共享错误响应 `details.usages` 返回；领域错误过滤器据此增加可选 `details`，其余错误响应维持原格式。

## 交接

无。
