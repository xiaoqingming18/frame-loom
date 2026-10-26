# Plan: 项目媒体、生成归属与孤儿清理

Status: draft
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

- [ ] T1 抽出 `describe`，实现 `resolve` 与元数据补写 — 验证：单测覆盖三处位置的优先级、回收区找回、元数据缺失补写；现有 generation 测试不回退
- [ ] T2 实现项目媒体上传与补齐，页面保存时检查缺失 — 验证：集成测试从全局、其他项目、回收区补齐，仍缺失时返回列表且保存成功
- [ ] T3 生成任务接入项目字段、暂存与恢复复制，对象存储改用解析器 — 验证：集成测试用模拟供应商覆盖产物写入项目、项目不可用暂存、恢复后复制，旧任务无项目字段照常运行
- [ ] T4 实现引用集合与自动／手动清理、会话避让 — 验证：集成测试覆盖三类引用不被清理、30 天与 1 小时过期（注入时钟）、会话打开时跳过、dryRun 统计与实际结果一致
- [ ] T5 实现启动时的全局目录清理 — 验证：集成测试中暂存产物与未结束任务的文件保留，其余被删除，任务记录保留

## 验证

- 预期：`pnpm --filter @frame-loom/engine test`、`pnpm --filter @frame-loom/engine typecheck` 通过。
- 实际：未执行。

## 进度

- 2026-10-26：创建子计划草稿。

## 发现与偏差

无。

## 交接

尚未开始；等待 02。
