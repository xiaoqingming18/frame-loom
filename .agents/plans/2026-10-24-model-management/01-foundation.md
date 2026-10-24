# Plan: 基础设施：写接口、密钥与事件

Status: done
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

- [x] T1 放开 `apps/engine/src/application.ts` 的 CORS：`methods` 为 GET、POST、PATCH、PUT、DELETE，`allowedHeaders` 加 `Content-Type`；补充预检测试 — 验证：engine 测试覆盖可信 Origin 的 POST 预检通过、非法 Origin 返回 403
- [x] T2 在主进程 `apps/desktop/src/main/` 实现主密钥：
  - 首次启动生成 32 字节主密钥，用 safeStorage 加密后原子写入 `<userData>/secret-key.bin`；
  - 解密失败时把旧文件改名为 `.broken` 并重新生成；
  - safeStorage 不可用时向 engine 传入空值，并显示提示；
  - 核对 Electron 45 是否有异步 API。

  验证：main 单测覆盖首次生成、再次读取、文件损坏、safeStorage 不可用四种情况
- [x] T3 engine 配置新增 `FRAME_LOOM_SECRET_KEY`（64 位十六进制，可为空），并实现 `core/crypto`：AES-256-GCM、AAD 为表名与行 ID、未配置主密钥时拒绝加密 — 验证：单测覆盖往返加解密、调换 AAD 后失败、篡改密文后失败、未配置时报错
- [x] T4 `EngineLogger` 增加屏蔽：`x-api-key`、`api-key`、`x-goog-api-key` 请求头，URL 中的 `key=`，预签名参数，以及运行时登记的明文密钥 — 验证：日志测试中这些值都不出现
- [x] T5 contracts 定义事件 schema；engine 的 `core/events` 提供类型化事件总线和 `GET /events`（`@Sse()`，需要鉴权，定时发心跳） — 验证：engine 测试读流收到心跳和测试事件，不带 token 时返回 401
- [x] T6 renderer 的 `lib/engine-client.ts` 支持 POST、PATCH、PUT、DELETE 的 JSON 请求体，并新增 `stream(path, schema)`：用 fetch 读 SSE，token 放请求头，支持取消，断线后由调用方重连 — 验证：client 单测覆盖写请求、事件解析、非法事件、取消
- [x] T7 原地同步 [engine 服务](../../notes/implemented/architecture/2026-10-24-engine-service.md)笔记中的环境变量、CORS 与日志屏蔽事实 — 验证：`pnpm run verify` 通过

## 验证

- 预期：`pnpm test`、`pnpm typecheck`、`pnpm lint`、`pnpm run verify` 通过；开发窗口健康页正常，不带 token 访问 `/events` 返回 401。
- 实际：`pnpm test` 全部 285 项通过（contracts 77、engine 95、desktop 113）；覆盖可信 POST 预检、非法 Origin、AES-GCM 篡改与 AAD、动态日志登记、SSE 鉴权与心跳、打开流时关闭服务、JSON 写请求、跨块与多行 SSE、非法事件及取消。
- `pnpm typecheck`、`pnpm lint`、`pnpm format:check`、`pnpm run verify`、`git diff --check` 通过；`pnpm build` 与 `pnpm --filter @frame-loom/desktop package:dir` 成功。
- `pnpm --filter @frame-loom/desktop test:e2e` 4 项通过；新增真实 safeStorage 解密检查（不返回主密钥）、文件不含主密钥明文、重启后密文不变、renderer 匿名 `/events` 返回 401、鉴权后收到 heartbeat。
- `node .cache/verify-model-foundation.mjs packaged` 与 `node .cache/verify-model-foundation.mjs dev` 通过：开发窗口及加固 exe 的明暗健康页正常，主密钥文件存在，匿名事件流 401，鉴权后收到 heartbeat，无页面或 CSP 错误，正常关闭退出码为 0、检查的进程均退出。已检查 `.cache/model-foundation-{dev,packaged}-{light,dark}.png` 四张截图；探针和日志不入库。
- 本轮未重做 NSIS 安装／卸载、厂商真实调用或远端 CI；这些不属于 01 的完成条件。

## 进度

- 2026-10-24：创建子计划草稿。
- 2026-10-24：用户授权实施 01，父计划与本子计划转为 active；已核对现有鉴权、日志、客户端与 Electron 45 异步 safeStorage 类型。
- 2026-10-25：完成 T1～T7、285 项单测、4 项桌面 e2e、开发窗口与加固产物验证，父计划同步 01 为 done；实现与相关笔记同批提交。

## 发现与偏差

- Electron 45 使用 `isAsyncEncryptionAvailable()`、`encryptStringAsync()` 与返回 `{ result, shouldReEncrypt }` 的 `decryptStringAsync()`；重加密失败与暂时不可用不视为损坏，不轮换仍可恢复的主密钥。暂时不可用只提供错误消息，已添加升级复核的 `shortcut:` 注释并记录依据。
- 当前事件仅包含 heartbeat 和 `generation.job.updated { jobId }`；完整任务契约由 03 定义，不提前引入任务状态和数据库表。SSE 不持久化、不重放，调用方重连后补拉。
- 首轮全仓测试与类型检查同时运行时，三项 engine 测试超时；单独以两 worker 复跑后 94 项通过，随后默认 `pnpm test` 两轮均通过（最终 95 项 engine 测试），未放宽全局超时或修改测试并发配置。
- 本轮只完成 01。父计划保持 active，02～05 保持 draft；模型管理提案仍为 proposed，整体转 implemented 留给 05 收尾。

## 交接

无。
