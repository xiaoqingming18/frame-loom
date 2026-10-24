# Plan: 基础设施：写接口、密钥与事件

Status: draft
Parent: plan.md

## 目标

为后续模块准备横切设施：

- engine 接受鉴权后的写请求；
- 密钥字段用主进程交付的主密钥加密；
- 日志屏蔽厂商凭据；
- 提供 `GET /events` SSE 推送；
- renderer 的 engine client 能发写请求、读取事件流。

## 前置条件

- 无。

## 步骤

- [ ] T1 放开 `apps/engine/src/application.ts` 的 CORS：`methods` 为 GET、POST、PATCH、PUT、DELETE，`allowedHeaders` 加 `Content-Type`；补充预检测试 — 验证：engine 测试覆盖可信 Origin 的 POST 预检通过、非法 Origin 返回 403
- [ ] T2 在主进程 `apps/desktop/src/main/` 实现主密钥：
  - 首次启动生成 32 字节主密钥，用 safeStorage 加密后原子写入 `<userData>/secret-key.bin`；
  - 解密失败时把旧文件改名为 `.broken` 并重新生成；
  - safeStorage 不可用时向 engine 传入空值，并显示提示；
  - 核对 Electron 45 是否有异步 API。

  验证：main 单测覆盖首次生成、再次读取、文件损坏、safeStorage 不可用四种情况
- [ ] T3 engine 配置新增 `FRAME_LOOM_SECRET_KEY`（64 位十六进制，可为空），并实现 `core/crypto`：AES-256-GCM、AAD 为表名与行 ID、未配置主密钥时拒绝加密 — 验证：单测覆盖往返加解密、调换 AAD 后失败、篡改密文后失败、未配置时报错
- [ ] T4 `EngineLogger` 增加屏蔽：`x-api-key`、`api-key`、`x-goog-api-key` 请求头，URL 中的 `key=`，预签名参数，以及运行时登记的明文密钥 — 验证：日志测试中这些值都不出现
- [ ] T5 contracts 定义事件 schema；engine 的 `core/events` 提供类型化事件总线和 `GET /events`（`@Sse()`，需要鉴权，定时发心跳） — 验证：engine 测试读流收到心跳和测试事件，不带 token 时返回 401
- [ ] T6 renderer 的 `lib/engine-client.ts` 支持 POST、PATCH、PUT、DELETE 的 JSON 请求体，并新增 `stream(path, schema)`：用 fetch 读 SSE，token 放请求头，支持取消，断线后由调用方重连 — 验证：client 单测覆盖写请求、事件解析、非法事件、取消
- [ ] T7 原地同步 [engine 服务](../../notes/implemented/architecture/2026-10-24-engine-service.md)笔记中的环境变量、CORS 与日志屏蔽事实 — 验证：`pnpm run verify` 通过

## 验证

- 预期：`pnpm test`、`pnpm typecheck`、`pnpm lint`、`pnpm run verify` 通过；开发窗口健康页正常，不带 token 访问 `/events` 返回 401。
- 实际：未执行。

## 进度

- 2026-10-24：创建子计划草稿。

## 发现与偏差

无。

## 交接

未开始，等待笔记与计划评审。
