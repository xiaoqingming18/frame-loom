# Plan: 主进程能力与协议

Status: draft
Parent: plan.md

## 目标

- `apps/desktop/src/main/desktop-ipc.ts` 新增 `dialog:pick-directory`、`project:reveal`、`project:trash`、`preferences:get`、`preferences:set`，全部校验 `isTrustedSender`，参数用 contracts 校验。`project:reveal` 与 `project:trash` 通过主进程持有的 engine 连接查询项目根目录，解析路径并核对 `.frameloom/project.json` 的 id 后执行 `shell.showItemInFolder` 或 `shell.trashItem`。
- `apps/desktop/src/main/preferences.ts` 改为读取、合并、原子替换，新增 `projectLocation`、`projectSort`、`assetView`；默认保存位置 `<文档>\Frame Loom\Projects`。
- 新协议 `frame-project://<projectId>/media/<sha256>` 与 `frame-project://<projectId>/assets/<编码路径>`：转发到 engine 文件接口，携带 Bearer、透传 `Range` 与响应头，CORS 只允许可信 renderer 源。
- `PRODUCTION_CSP` 的 `img-src`、`media-src` 加入 `frame-project:`；preload 与 `lib/desktop-bridge.ts` 暴露对应方法。

## 前置条件

- 02、04 完成（项目查询与文件读取接口）。

## 步骤

- [ ] T1 偏好合并写入与新字段 — 验证：单测中写入排序后主题不丢失，损坏文件回退默认值
- [ ] T2 目录选择、显示、回收站 IPC — 验证：单测覆盖不可信调用方、非法参数、id 不匹配、`path` 指向 `.frameloom`、资产删除缺少 `path` 均被拒绝
- [ ] T3 `frame-project` 协议注册与转发 — 验证：单测覆盖非法 URL 403、Range 透传、engine 不可用时 502，CORS 只返回可信源
- [ ] T4 CSP、preload 与桥接 — 验证：`security.test.ts`、`preload/index.test.ts`、`desktop-bridge.test.ts` 更新后通过
- [ ] T5 构建 — 验证：`pnpm --filter @frame-loom/desktop typecheck`、`pnpm --filter @frame-loom/desktop test`

## 验证

- 预期：desktop 单测与类型检查通过。
- 实际：未执行。

## 进度

- 2026-10-26：创建子计划草稿。

## 发现与偏差

无。

## 交接

尚未开始；等待 02、04。
