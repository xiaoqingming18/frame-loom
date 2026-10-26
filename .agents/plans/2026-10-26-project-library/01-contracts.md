# Plan: 契约与名称规则

Status: draft
Parent: plan.md

## 目标

`packages/contracts/src/projects.ts` 提供 engine、主进程和 renderer 共用的契约：

- `ProjectManifest`（`format`、`formatVersion: 1`、`id`、`name`、`createdAt`、`updatedAt`、`pages[]`），以及 `ProjectPageSummary`（`id`、`name`、`createdAt`、`updatedAt`、`coverSha256`）。解析时保留未知顶层字段。
- `ProjectPageFile`（`format`、`formatVersion`、`id`、`revision`、`document: CanvasDocument`）。
- `ProjectSummary`（注册表视图，含 `status: available | missing | mismatch | unreadable | too_new` 与 `rootPath`）、`ProjectCreateRequest`、`ProjectOpenRequest`、`ProjectRenameRequest`、页面增删改与保存请求／结果。
- `AssetEntry`（名称、相对路径、类型、大小、修改时间、媒体类别）、资产各请求体与搜索结果（含 `truncated`）。
- `validateEntryName(name)`：用于项目、创作页、文件夹和资产名称，返回中文错误；`assetPath` 校验相对路径（`/` 分隔、拒绝 `..`、盘符、`\0`、`.frameloom` 前缀、设备名）。
- `desktop.ts` 新增 `ProjectSort`、`AssetView`、`DesktopPreferences`，以及新 IPC 参数 schema。
- `GenerationRequest` 增加可选的 `projectId`、`pageId`。

## 前置条件

- 无。

## 步骤

- [ ] T1 编写项目清单与页面文件 schema，未知字段保留，过高 `formatVersion` 单独报错 — 验证：单测覆盖合法、缺字段、未知字段往返、版本过高
- [ ] T2 编写 `validateEntryName` 与 `assetPath` — 验证：表驱动单测覆盖 `<>:"/\|?*`、控制字符、尾随点或空格、`CON`／`com1.txt`、1–80 字符边界、`..`、`C:`、`.frameloom/x`
- [ ] T3 编写注册表、资产、请求与结果 schema，导出到 `index.ts` — 验证：`pnpm --filter @frame-loom/contracts typecheck`
- [ ] T4 扩展 `desktop.ts` 的偏好与 IPC 参数、`GenerationRequest` 的项目字段 — 验证：contracts 单测，旧请求不带项目字段仍通过
- [ ] T5 构建 contracts — 验证：`pnpm --filter @frame-loom/contracts test`、`pnpm --filter @frame-loom/contracts build`

## 验证

- 预期：contracts 单测、typecheck、build、`pnpm exec eslint packages/contracts/src` 通过。
- 实际：未执行。

## 进度

- 2026-10-26：创建子计划草稿。

## 发现与偏差

无。

## 交接

尚未开始。
