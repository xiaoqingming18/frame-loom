# Plan: 素材交付、任务快照与安全恢复

Status: draft
Parent: plan.md

## 目标

完成供应商素材上传、完整调用快照、恢复与重试边界，避免配置漂移和不确定提交导致重复生成。

## 前置条件

01、02 完成且取得实施授权。阅读 `apps/engine/src/modules/generation/generation.service.ts`、`generation.schema.ts`、`media.service.ts`、`media-probe.ts`、现有对象存储模块和 `packages/contracts/src/generation.ts`、`events.ts`，复用既有调度与素材存储。

## 步骤

- [ ] T1 根据适配器声明交付 binary/data URI/public URL/provider file，接入 FastAIToken `api/v1/uploads` — 验证：本地素材上传后再提交，私网 URL 和不支持的数据形式在提交前拒绝。
- [ ] T2 持久化上传结果与素材引用，按内容、目标和凭据归属隔离复用，处理失效和未知上传结果 — 验证：重启复用、失效恢复、账号切换不会错误复用或无限重复上传。
- [ ] T3 提交前持久化版本化调用快照及稳定幂等键，凭据和敏感头仅存安全引用 — 验证：修改模型地址、型号、档案后在途任务仍使用原快照，凭据不可用明确暂停。
- [ ] T4 实现已受理、结果待确认、等待暂停、远端失败和下载失败的区分，幂等重试仅按协议支持启用 — 验证：FastAIToken 同任务同键同请求，其他未知提交不自动重发；本地超时可恢复查询。
- [ ] T5 建立旧任务兼容恢复路径与本地／远端取消语义，已有远端 ID 只查询 — 验证：缺快照且不能确认目标时暂停，历史失败不自动重跑，重启不重复生成，远端取消未确认不伪报成功。
- [ ] T6 增加分阶段脱敏诊断和结果下载鉴权隔离 — 验证：错误包含安全路由、HTTP／业务码与请求 ID；密钥、提示词、签名参数不入日志，CDN 下载不携带渠道鉴权头。

## 验证

预期运行 `pnpm --filter @frame-loom/engine test`、`pnpm --filter @frame-loom/contracts test`、`pnpm run typecheck`、`pnpm run verify`。在 `generation.integration.test.ts`、`video.integration.test.ts` 与数据库测试使用持久化 SQLite、可控上游和进程重启／中断场景，精确计数提交与上传，验证下载失败仅重试下载。尚未执行。

## 进度

- 2026-10-27：完成计划编制，未创建快照字段、上传记录或状态变更。

## 发现与偏差

旧任务的历史地址和凭据无法从当前配置可靠反推；实现必须显式承认缺失，不伪造快照。供应商上传保存期限及清理能力需按实际文档处理。

## 交接

等待 01、02 与实施授权。下一步先确定素材交付及快照的持久化边界，再接调度恢复；不得操作真实任务做故障注入。
