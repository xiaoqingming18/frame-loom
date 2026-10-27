# Plan: 模型连接契约、操作路由与兼容迁移

Status: draft
Parent: plan.md

## 目标

建立明确的模型连接配置、唯一 URL 拼接语义和可验证的旧配置迁移，满足关联笔记的配置与地址验收要求。

## 前置条件

取得实施授权。阅读父计划与关联笔记，并检查 `packages/contracts/src/models.ts`、`generation.ts`，`apps/engine/src/modules/channels/`、`generation/generation.schema.ts`、`apps/engine/drizzle/` 和数据库迁移测试。旧表结构和迁移序号以执行时仓库为准。

## 步骤

- [ ] T1 定义版本化模型连接、相对操作路径、模板版本及覆盖契约，区分渠道目录与模型调用 — 验证：contracts 拒绝非法地址、路径逃逸、类别／协议不匹配和能力越界。
- [ ] T2 建立唯一 URL 解析器，覆盖提交、查询、内容、上传和目录，预览与请求复用 — 验证：部署前缀、尾斜杠、已有版本、占位 ID、`/api/v1` 上传均有精确期望 URL。
- [ ] T3 在 channels 存取与事务保存中接入模型地址继承／覆盖和声明式模板，凭据仍加密引用 — 验证：草稿拉取不写库，更新失败事务回滚，模板更新不改变旧模型。
- [ ] T4 新增可重复验证的兼容迁移，保留旧有效 URL、已有显式档案和任务记录，不重写分发迁移 — 验证：旧版本数据库升级后文本／图片／视频／TTS 的原请求目标不变，失败事务可回滚。
- [ ] T5 为后续任务快照提供版本和路由序列化边界，标识旧任务缺失快照而非伪造历史 — 验证：新增配置可往返读取，未知版本拒绝误执行，历史失败任务未变更。

## 验证

预期运行 `pnpm --filter @frame-loom/contracts test`、`pnpm --filter @frame-loom/engine test`、`pnpm run typecheck` 和 `pnpm run verify`。重点扩展 `models.test.ts`、channels／llm 集成测试及 `apps/engine/src/core/database/database.service.test.ts`，断言完整 URL 和凭据边界。尚未执行。

## 进度

- 2026-10-27：完成计划编制，未开始实现。

## 发现与偏差

文本 SDK 和渠道列表已有不同路径约定，不能全局删补 `/v1`；其兼容层必须在迁移测试中被覆盖。

## 交接

等待实施授权；取得授权后从 T1 开始。当前没有本子计划的代码或迁移，用户数据库未改。
