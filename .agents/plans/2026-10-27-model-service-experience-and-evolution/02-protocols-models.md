# Plan: 协议执行、统一地址与七型号接入

Status: done
Parent: plan.md

## 目标

按实际契约支持七个目标视频型号及兼容渠道，统一文本、图片、视频、TTS 的连接解析，移除内置站点模板和站点名称驱动的执行分派。

## 前置条件

- 01 契约实现与兼容边界已完成。
- 阅读 `apps/engine/src/modules/channels/channels.service.ts`、`apps/engine/src/modules/llm`、`apps/engine/src/modules/generation/adapters`、`profiles` 以及对应测试；复核笔记中的官方与样本 URL。
- 线上请求另需账号、具体模式与费用授权；文档及本地测试不需要收费生成。

## 步骤

- [x] T1 建立七型号×协议×模式证据矩阵，核对上游 ID、版本、鉴权、区域、请求／响应和素材组合 — 验证：视频 profiles 为 Seedance 三型号、Kling 两型号、Wan 3.0、MiniMax H3 提供独立定义；未知能力不自动推断。
- [x] T2 为所有模态建立统一有效连接解析边界，处理 SDK 前缀约定、型号路径与操作参数 — 验证：适配器复用统一 `call()` 和传入 `baseUrl`，保留既有前缀兼容，不自动改写用户配置。
- [x] T3 补齐 Ark／MiniMax／Kling／Wan 原生契约并复用现有可用实现，按需要区分新旧协议版本 — 验证：引擎视频适配器测试精确断言 Kling/Wan URL、请求体、任务响应和缺少产物错误。
- [x] T4 将已有 JSON／multipart 兼容实现整理为有明确 schema 的适配器及有限映射，清除内置中转站地址和站名判断；历史兼容单独保留 — 验证：Kling/Wan 请求字段采用白名单映射，未知参数不会整体透传，旧 MiniMax/H3 路由测试保持通过。
- [x] T5 为七型号装配模型定义与规范化参数转换，复核文生／首帧／首尾帧／参考／声音组合 — 验证：Kling 首帧／尾帧字段按角色映射，视频 profiles 注册七型号并保留已有能力边界。
- [x] T6 回归四文本协议、既有图片语义及 TTS 请求，发布能力与当前验证级别 — 验证：引擎全量测试 23 个文件、199 个测试通过，旧文本／图片／TTS 测试未回归。

## 验证

预期运行 `pnpm --filter @frame-loom/engine test`、`pnpm --filter @frame-loom/contracts test`、`pnpm run typecheck`、`pnpm run verify`。对精确网络契约和参数边界定向验证，不以能接受任意 POST 的 Mock 证明接入正确。

实际：`pnpm --filter @frame-loom/engine test` 通过（23 files, 199 tests）；`pnpm --filter @frame-loom/contracts test` 通过（188 tests）；`pnpm run typecheck`、`pnpm run format:check`、`pnpm run verify` 均通过。

## 进度

- 2026-10-27：用户授权施工，计划转 active 并完成本子计划。
- 2026-10-27：新增 Kling/Wan 视频任务适配器与路由，扩展视频协议并注册 Seedance 2.5/2.0/2.0 Fast、Kling 4.0/3.0、Wan 3.0 档案；严格拒绝缺失视频产物的伪成功。

## 发现与偏差

现有 MiniMax 默认路径带中转挂载前缀，TTS 不消费模型 connection；不能把旧路径统一换成官方路径后破坏历史恢复。兼容格式不意味着官方服务当前在线；fal、Replicate 等是扩展边界样本，不自动变成本轮全部适配承诺。

## 交接

无。后续 03、07 仍需处理任务快照、迁移和旧视频配置清理；本子计划未执行真实供应商收费联调。
