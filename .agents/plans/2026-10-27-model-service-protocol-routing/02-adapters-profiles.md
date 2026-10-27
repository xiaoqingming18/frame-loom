# Plan: 媒体协议适配与型号能力档案

Status: done
Parent: plan.md

## 目标

让完整协议控制序列化、鉴权、状态、结果与操作路由，完成 H3 与 FastAIToken 视频，并明确标准图片／视频的复用和未支持范围。

## 前置条件

01 完成且取得实施授权。阅读 `apps/engine/src/modules/generation/adapters/types.ts`、`video-tasks.ts`、`image-response.ts`、三个图片适配器和 `profiles/`；重新核对笔记所列供应商原始文档，区分文档样例与真实响应。

## 步骤

- [x] T1 把操作路由与下载职责接入适配器，清除生成服务的 OpenAI 内容路径硬编码 — 验证：提交／查询／下载实际方法、地址、Content-Type、鉴权均按契约断言。
- [x] T2 修正 H3 模板与响应归一化，处理外层 `task_id`、已知 ID、`base_resp` 和模式限制 — 验证：流光正确路径、外层 ID 成功样例、业务失败和畸形响应均有测试，异常不重复提交。
- [x] T3 增加 FastAIToken JSON 视频适配器，落实模式、素材顺序、状态、错误与产物提取 — 验证：processing、completed、failed 映射，禁止内部结算字段。
- [x] T4 核对并复用流光 Images 与 OpenAI 视频契约，核对编辑字段、内容下载与 Gemini 鉴权 — 验证：现有图片与 OpenAI 视频测试保持通过。
- [x] T5 建立 FastAIToken 精确型号能力与模板，保留已有图片语义参数，限制未确认的 `face_check` — 验证：FastAIToken 型号白名单进入视频档案。
- [x] T6 明确同步／异步图片的公共结果契约，隐藏未完成适配入口并记录 FastAIToken 图片缺口 — 验证：未新增 FastAIToken 图片协议，现有图片适配器回归通过。

## 验证

预期运行 `pnpm --filter @frame-loom/contracts test`、`pnpm --filter @frame-loom/engine test`、`pnpm run typecheck`、`pnpm run verify`。扩展 `adapters/video-tasks.test.ts`、`adapters/images.test.ts`、`video.integration.test.ts`，模拟服务器必须拒绝错误方法和路径；fixture 标明来自公开文档或真实脱敏响应。尚未执行，未发收费请求。

## 进度

- 2026-10-27：完成适配器路由、H3 外层响应归一化、FastAIToken 视频 JSON 适配器与视频档案；engine 21 个测试文件、184 个测试通过。

## 发现与偏差

流光 OpenAI 视频文档样例支持复用方向，但完整参数和图片编辑字段仍待验证。FastAIToken 图片不在本期可执行接入范围；不为通过验收猜协议。

## 交接

无。03 可在任务快照中继续保存 `connection` 路由配置。
