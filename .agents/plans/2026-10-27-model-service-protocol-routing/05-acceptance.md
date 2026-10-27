# Plan: 模型服务迁移回归与供应商接入验收

Status: dropped — 已完成本地证据保留，剩余验收交新重构计划
Parent: plan.md

## 目标

证明接入契约、迁移和恢复满足关联笔记验收条件，明确真实供应商验证范围与剩余缺口。

## 前置条件

01～04 完成且取得实施授权。真实生成另需明确账号、型号、模式和费用范围授权；没有授权则只做模拟验证并记录外部验收未完成。使用测试数据库与测试项目，不覆盖用户真实历史。

## 步骤

- [x] T1 汇总各适配器精确 wire 测试，补齐方法、URL、请求体、鉴权、业务错误和下载路径矩阵 — 验证：错误路径服务器返回失败，无法被接受任意 POST 的 Mock 掩盖。
- [x] T2 从旧版本数据库验证升级、失败回滚、历史任务保留和在途恢复 — 验证：不全局改地址，不自动重跑 H3 历史任务，配置漂移与凭据删除状态可解释。
- [x] T3 完成重启、未知提交、幂等键、素材失效、下载失败与取消回归 — 验证：提交调用次数符合协议，已有远端任务不二次创建，诊断与日志脱敏。
- [x] T4 完成设置与画布端到端及文本／图片／视频／TTS 兼容回归 — 验证：明暗主题、参数约束、模型跨域覆盖和原有资产写回均有证据。
- [ ] T5 在明确授权范围内进行流光 H3、标准兼容入口及 FastAIToken 视频真实联调 — 验证：分别记录提交、查询、结果落盘和参考素材模式结果，未测型号不外推为通过。
- [ ] T6 运行质量门禁、整理支持矩阵与缺口，核对所有步骤后同步笔记和计划状态 — 验证：`pnpm run verify` 与全部约定门禁通过；无未完成项才将笔记移入 implemented 并更新链接，计划转 done。

## 验证

预期命令：`pnpm run test`、`pnpm run typecheck`、`pnpm run lint`、`pnpm run format:check`、`pnpm run build`、`pnpm --filter @frame-loom/desktop test:e2e`、`pnpm run verify`。若串行测试或环境限制需要调整命令，在进度中记录实际命令和结果，不能只保留预期。

真实联调使用已授权的最小测试集并记录费用边界；不自动批量测试所有型号。本轮仅使用临时数据库、临时项目与本机 HTTP 服务器，没有读取或改写用户真实历史，也没有发起供应商收费生成。

### 实际质量门禁（2026-10-27）

环境为 Node.js 24.22.0、pnpm 12.15.0。以下命令均已实际执行并通过，日志保存在忽略目录 `.cache/`：

| 命令 | 实际结果 |
| --- | --- |
| `pnpm run test` | 71 个测试文件、660 项通过：contracts 186、canvas 100、desktop 177、engine 197 |
| `pnpm run typecheck` | 全工作区通过 |
| `pnpm run lint` | 通过 |
| `pnpm run format:check` | 全部文件通过 Prettier 检查 |
| `pnpm run build` | engine 与 desktop 构建通过 |
| `pnpm --filter @frame-loom/desktop test:e2e` | 16 项通过，耗时 1.9 分钟 |
| `pnpm run verify` | 22 篇笔记的结构、链接与格式通过，50 份计划通过 |
| `git diff --check` | 通过 |

本地门禁通过不等于真实供应商验收完成；T5 未执行，T6 的整体完成条件仍未满足。

### 支持与验证矩阵

下表路径均相对有效服务地址；旧配置的版本前缀兼容由路由测试独立覆盖。路径覆盖不改变请求体协议。表内通过均指本地模拟或契约验证，所有供应商真实账号、型号权限、余额和参考素材线上效果仍未验证。

| 接入 | 提交与查询 | 请求体／鉴权 | 结果与证据 |
| --- | --- | --- | --- |
| Ark 视频 | POST `contents/generations/tasks`；GET `contents/generations/tasks/{id}` | JSON、Bearer | 响应视频 URL；严格 HTTP 方法、部署前缀、错误地址与错误密钥见 `apps/engine/src/modules/generation/adapters/video-tasks.test.ts`；S3 参考、URL 过期重查与落盘见 `apps/engine/src/modules/generation/video.integration.test.ts` |
| 流光 H3 原生 | POST `minimax/v2/video_generation`；GET `minimax/v2/query/video_generation/{id}` | JSON、Bearer | 外层 ID、审核失败、HTTP 200 的非零 `base_resp.status_code` 安全失败及响应 URL 解析见 `video-tasks.test.ts`；不承诺未开放原生再生成动作 |
| OpenAI 兼容视频 | POST `videos`；GET `videos/{id}`；GET `videos/{id}/content` | multipart、Bearer；首帧 `input_reference` | 严格 wire 与 ID 编码见 `video-tasks.test.ts`；带部署前缀及凭据的内容下载、视频探测和落盘见 `video.integration.test.ts` |
| FastAIToken 视频 | POST `v1/videos/generations`；GET `v1/videos/{id}`；GET `v1/videos/{id}/content`；POST `api/v1/uploads` | JSON、Bearer、稳定 `Idempotency-Key`；上传为 file multipart | URL／内容端点两条结果路径、上传复用与未知结果、重启和幂等见 `video-tasks.test.ts`、`video.integration.test.ts`、`apps/engine/src/modules/generation/recovery.integration.test.ts` |
| OpenAI／Ark Images、Gemini 原生图片 | POST `images/generations`、`images/edits` 或 `models/{model}:generateContent` | JSON 或编辑 multipart；Bearer 或 Gemini API key | 精确路径、图片字段、鉴权、错误分类、解析和错误路由拒绝见 `apps/engine/src/modules/generation/adapters/images.test.ts`；画布多图与资产写回见 Electron E2E |
| 文本目录与调用、OpenAI／MiniMax TTS | 保留原目录与文本 SDK 约定；TTS POST `/v1/audio/speech`、`/v1/t2a_v2` | 既有文本协议；TTS JSON、Bearer | `apps/engine/src/modules/channels/` 的测试及 `apps/engine/src/modules/generation/adapters/tts.test.ts` 覆盖兼容、音频解码与鉴权错误；没有新增文本／TTS 界面 |
| 未启用范围 | FastAIToken 图片、MJ 扩展动作、`face_check`；独立 `image_to_video` 入口 | 契约缺失或不在首批实现范围 | 不从视频成功或型号前缀外推；现有视频界面仅开放 text／frames／reference，参数按精确档案约束 |

### 迁移与恢复证据

- `apps/engine/src/core/database/database.service.test.ts` 从 0008 旧库升级至当前 schema 6，核对旧 `/v1` 地址和 H3 失败历史不变、新连接配置为空及快照为空；在临时迁移副本故意令 0010 失败，证明 0009／0010 整批回滚，journal、列结构与历史任务保留；备份副本仍可打开读取。未修改已分发迁移。
- `recovery.integration.test.ts` 验证重启后沿用冻结请求、同键同体恢复、配置漂移不换目标、凭据变更或删除暂停、引用过期重传、未知上传暂停、旧任务缺快照暂停、下载失败只重试下载和取消；CDN 请求不含渠道密钥及私有头，诊断不含提示词和签名查询串。
- `packages/contracts/src/models.test.ts` 和 generation／channels 测试覆盖部署与版本前缀、模型跨域覆盖、能力及参数约束；`apps/desktop/e2e/model-routing.test.ts` 验证配置保存不发起生成，`generation-image.test.ts` 验证三张图片、单张失败重试、首帧视频及重启保留，项目资产 E2E 验证写回和双向复制。
- 已实际查看本轮生成的 `media-routing-light.png`／`media-routing-dark.png`（800×800）及 `canvas-generation-light.png`／`canvas-generation-dark.png`；标签、路由预览、中文输入、画布参考连接在明暗主题可见，窄窗口无横向溢出由 E2E 断言覆盖。截图位于忽略目录 `apps/desktop/test-results/`，不作为版本化产物提交。

## 进度

- 2026-10-27：完成验收计划编制，未执行实现测试或真实生成。
- 2026-10-27：按用户授权执行 05 本地验收，补强严格 HTTP 路由、旧库升级／故障回滚、凭据删除与内容端点下载测试；修复 H3 非零业务码漏判，并为图片 E2E 测试渠道补齐本地假密钥。完整 Electron E2E 16 项通过，已查看设置与画布明暗截图；真实联调未执行。

## 发现与偏差

2026-10-27 用户确认新范围后，本计划转 dropped；下述阻塞与质量结果是旧范围的历史证据，后续执行以交接入口为准。

文档声明、模拟测试、真实账号成功是不同证据层级。真实联调受阻时保留未完成状态并说明阻塞，不能用旧计划或模拟结果替代。

02 原有用例仅验证 `base_resp.status_code = 0`，未证明非零码会失败；05 补测发现实际遗漏，在共享 H3 响应检查处修复。首次 E2E 中图片渠道缺密钥导致安全暂停，已修测试夹具；快捷面板 Escape 曾单次失败，定向与完整重跑均通过，未用延时或弱化断言掩盖。T6 的支持矩阵和本地门禁收尾可完成，但其整体完成条件仍受 T5 阻塞。

## 交接

T1～T4 的历史本地验证保留；T5、T6 不记为完成。后续转到[多模态服务重构计划](../2026-10-27-model-service-experience-and-evolution/plan.md)的 08，按七型号、实际接入和授权费用范围重新定义联调集，不继续执行旧站点模板目标。新方案未实现，本次仅更新文档交接，不重跑测试或发收费请求。
