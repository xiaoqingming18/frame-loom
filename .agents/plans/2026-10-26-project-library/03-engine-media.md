# Plan: 项目媒体、生成归属与孤儿清理

Status: done
Parent: plan.md

## 目标

- `apps/engine/src/modules/generation/media.service.ts` 拆出 `describe(path)`（文件头识别与 ffprobe），新增 `resolve(sha256, projectId?)`：项目 `media/` → 项目回收区（找回）→ 全局目录；元数据缺失时探测并补写 `media_files`。
- `POST /projects/:id/media`（二进制流，256 MiB）与 `POST /projects/:id/media/adopt { sha256[] }`（返回仍缺失的哈希）；页面保存时检查并尝试补齐缺失哈希。
- 生成任务读取 `projectId`／`pageId` 并校验项目可用；输入素材按项目解析；产物写入项目 `media/`，项目不可用时暂存到全局目录，项目恢复可用时复制。对象存储上传改用 `resolve`。
- 孤儿清理：引用集合（页面全部版本的 `sha256`／`posterSha256`、未结束任务、页面 `pendingJobIds` 对应任务的输入与产物）；自动清理移入 `trash/media/`，回收区 30 天、`tmp/` 1 小时过期；手动清理先统计再执行并清空回收区；画布打开期间不清理该项目；启动时清理全局目录且不删除暂存产物。
- 接口：`POST /projects/:id/media/cleanup?dryRun=`、`POST /projects/:id/sessions/open|close`（画布打开／离开，供清理避让与触发）。

## 前置条件

- 02 完成。

## 步骤

- [x] T1 抽出 `describe`，实现 `resolve` 与元数据补写 — 验证：集成测试覆盖项目解析、回收区找回、全局回退与元数据重建；原 generation 测试通过
- [x] T2 实现项目媒体上传与补齐，页面保存时检查缺失 — 验证：集成测试从全局、其他项目、回收区补齐，仍缺失时返回列表且保存成功
- [x] T3 生成任务接入项目字段、暂存与恢复复制，对象存储改用解析器 — 验证：模拟供应商覆盖产物写入项目、离线暂存、恢复复制与不复活孤儿；旧任务兼容和对象存储测试通过
- [x] T4 实现引用集合与自动／手动清理、会话避让 — 验证：三类引用、跨页面、全部版本和 poster 保护；注入时钟检查过期、dryRun 与实际一致、活动会话跳过、损坏页面停止
- [x] T5 实现启动时的全局目录清理 — 验证：暂存、未结束任务输入和产物保留，旧无项目完成任务文件删除、记录保留

## 验证

- 预期：`pnpm --filter @frame-loom/engine test`、`pnpm --filter @frame-loom/engine typecheck` 通过。
- 实际：全仓 `pnpm test` 598 项通过（engine 186 项），`pnpm typecheck`、`pnpm lint` 通过；新增 `project-content.integration.test.ts` 共 9 项集成测试，包含媒体与资产场景。
- 收尾：`pnpm format:check`、`pnpm run verify` 通过（21 篇笔记、44 份计划）；文件错误响应补丁后再次通过上述 9 项集成测试、engine typecheck 与 lint。

## 进度

- 2026-10-26：创建子计划草稿。
- 2026-10-26：完成 T1–T5，新增 0007 迁移、待复制产物状态、生成与对象存储接线，完成全仓回归；尚未提交。

## 发现与偏差

- 待复制哈希新增 `staged_outputs_json`，复制后清除，避免从全局副本反复恢复已清理孤儿；schema_version 升至 3，理由见父计划关联笔记。
- 项目页面不可读时停止本次清理；启动引用不可确认时跳过本轮全局清理。会话为当前单窗口项目集合，后续多窗口须升级为会话标识。

## 交接

无。
