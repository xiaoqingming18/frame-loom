# Plan: 项目设定、剧集与剧本存储

Status: done
Parent: plan.md

## 目标

engine 提供以下能力：项目设定、页面所属剧集、剧集的增删改，以及剧本的读写，包括 revision 冲突、外部修改检测、写入后修复摘要和回收区。规格见功能笔记的「数据格式」，以及「接口」表中项目、页面、剧集、剧本读写这几行。本子计划不涉及设定库同步和转换：`PUT script` 返回的 `addedElements` 暂时固定为 0，由 03 接上。

## 前置条件

- 01 已完成。
- 已阅读 `apps/engine/src/modules/projects/` 下的 `projects.service.ts`、`local-project-store.ts`、`project-store.ts`、`project-media.service.ts`、`projects.controller.ts`，以及 `projects.integration.test.ts` 的写法（`testEngine`、临时目录）。

## 步骤

- [x] T1 修改 `projects.service.ts`：
  - `create` 接受 `profile` 并写入清单，新建 `scripts/` 和 `trash/scripts/` 目录；
  - `inspect` 把 `profile` 带进 `ProjectSummary`；
  - 新增 `saveProfile(id, profile)`，在控制器中注册 `PUT /projects/:id/profile`。

  — 验证：集成测试覆盖：创建时带设定，读取清单得到同样的设定；`PUT` 非法题材返回 400；列表中带有 `profile`；旧项目没有 `scripts/` 目录时，`GET /projects/:id` 正常。
- [x] T2 页面所属剧集：
  - `createPage` 接受 `episodeId`；
  - `renamePage` 改为 patch 语义，接受 `name`、`episodeId`，两者都可选；
  - `episodeId` 必须指向已有的剧集，否则返回 404 `EPISODE_NOT_FOUND`。

  — 验证：集成测试覆盖：新建页面时带 `episodeId`；只改 `episodeId`；改为 `null`；指向不存在的剧集时返回 404。现有的 `projects.integration.test.ts` 用例全部通过。
- [x] T3 `ProjectStore` 和 `LocalProjectStore` 增加以下方法：
  - `readScript` 和 `writeScript`：复用 `atomicWrite`；冲突检查与 `readPage` 相同，比较 revision、mtimeNs、size 和内容摘要，返回 `SCRIPT_REVISION_CONFLICT`；
  - `trashScript` 和 `restoreScript`；
  - `readStory` 和 `writeStory`：`story.json` 不存在时返回空的设定库，revision 为 0。

  目录不存在时，用 `mkdir recursive` 补建，并且必须经过 `internalPath` 检查。

  — 验证：在 `local-project-store.test.ts` 中新增用例，覆盖：外部修改剧本文件（revision 不变但内容改变）后保存返回 409；目标文件被占用时，沿用现有的重试测试方式。
- [x] T4 新建 `apps/engine/src/modules/scripts/`，包含 `scripts.module.ts`、`episodes.service.ts`、`episodes.controller.ts`，并在 `app.module.ts` 中注册。

  剧集的新建、修改、删除、列表：
  - 新建时同时写入一份空剧本：revision 为 1，`document.blocks` 为空，`source` 和 `pendingImport` 都为 null；
  - 集号冲突时返回 409 `EPISODE_NUMBER_CONFLICT`，超过 500 集时返回 409 `EPISODE_LIMIT_EXCEEDED`；
  - 删除时，先把剧本移到回收区，然后在同一次清单写入中移除剧集，并把相关页面的 `episodeId` 置空；清单写入失败时恢复剧本。

  列表中的 `conversion` 暂时固定为 null，`pending` 暂时固定为 0，由 03 和 04 接上。

  — 验证：集成测试覆盖：增改删的完整流程；删除后剧本出现在 `trash/scripts/`，相关页面的 `episodeId` 为 null；注入清单写入失败时，剧本被恢复。
- [x] T5 剧本的 `GET` 和 `PUT`：
  - `PUT` 先用 `ScriptDocument` 校验请求体，再比较 revision；
  - 写完剧本文件后，回写剧集摘要（`scenes` 用 `deriveScenes` 计算，`chars` 为所有段落去掉空白后的字符数，`draft` 表示是否存在 `pendingImport`，还有 `updatedAt`）；
  - `GET` 发现摘要与剧本不一致时，修复摘要。

  — 验证：集成测试覆盖：保存后摘要的场次和字数正确；revision 过旧时返回 409；外部改写文件后保存返回 409；手动把清单摘要改错后，`GET` 剧本会修复摘要。
- [x] T6 修改 `project-media.service.ts` 的 `cleanupAt`：
  - 把 `trash/scripts` 加入清理列表，保留期为 30 天；
  - 目录不存在时跳过，不报错。

  — 验证：在 `project-content.integration.test.ts` 的过期清理用例中，加入一个 31 天前的剧本，清理后该文件被删除；旧项目没有这个目录时，清理不报错。

## 验证

- 预期：
  - `pnpm --filter @frame-loom/engine typecheck` 通过；
  - `pnpm --filter @frame-loom/engine exec vitest run src/modules/projects src/modules/scripts` 通过。

  engine 的 test 脚本会先构建依赖，所以执行前要先运行 `pnpm --filter @frame-loom/engine... build`。不运行 generation、model-services 的测试。
- 实际：`pnpm --filter @frame-loom/engine... build`、`pnpm --filter @frame-loom/engine typecheck` 通过；`pnpm --filter @frame-loom/engine exec vitest run src/modules/projects src/modules/scripts` 通过（5 文件、38 用例）。日志为 `.cache/episodes-storage-tests.log`。

## 进度

- 2026-10-29：创建子计划草稿。
- 2026-10-29：完成存储、剧集与项目接口，定向验证全部通过。

## 发现与偏差

剧集相关集成测试集中在 `scripts/episodes.integration.test.ts`，包含回收区清理用例；删除剧本时刷新回收文件 mtime，确保保留期从删除时开始。创建剧集后清单写入失败时，将孤立的空剧本移入回收区。

## 交接

无。
