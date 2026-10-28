# Plan: 表情检测 loader 使用完整同源 URL

Status: draft
Parent: plan.md

## 目标

以最小改动阻止 Vite 开发动态导入给本地 MediaPipe loader 再次添加 `?import`，保留现有模块 Worker、资源路径和 CSP。

## 前置条件

- 本次仅文档；获得后续修复实施授权后才执行步骤。
- 阅读 `packages/canvas/src/nodes/face-detection/worker.ts`、`packages/canvas/src/nodes/face-detection.ts`、`apps/desktop/electron.vite.config.ts`、`apps/desktop/src/main/security.ts` 和 `apps/desktop/src/main/index.ts` 的资源协议处理。
- 当前 loader、WASM 和人脸模型已存在于 desktop public 与 renderer 产物；先核对实际 dev 转换和请求，不把路径错误或缺文件诊断与本次 query 注入混为一谈。

## 步骤

- [ ] T1 核对当前安装 Vite 对动态 import 的 query 注入与完整 URL 处理 — 验证：只读取得实际 worker 转换片段、loader 普通请求与 import-query 请求结果；日志只保留必要片段。
- [ ] T2 在 `self.import` 边界将清理后路径解析成 `new URL(cleanPath, self.location.href).href` 再动态导入 — 验证：保留原 @vite-ignore、MediaPipe fallback、JS／WASM／模型根路径；不改 publicDir、Worker 形态和 CSP。
- [ ] T3 追加一个小型参数化 URL 边界测试 — 验证：根路径在开发和 app origin 下得到完整 URL；已有完整 URL 保持目标；原 import-query 清理后不残留错误查询。复用现有测试设施，不复制／修改 Vite 内部 helper。

## 验证

### 必须执行

- URL 边界测试只运行对应 canvas 测试文件；若 contracts 的 dist 不可用，先 `pnpm --filter @frame-loom/contracts build`，再用 `pnpm --filter @frame-loom/canvas exec vitest run` 后接实际文件路径。
- 对照 diff 确认没有新增 Blob、远端脚本或连接许可。真实 Vite 检测和目录版兼容由 03 一次完成，这里不重复启动应用。

### 省略与扩测条件

- 不测试与修复无关的情绪预设、3D 动画或后处理像素；不安装依赖、不修改 WASM 二进制。
- 若当前工具链实际转换已不同于诊断基线，先更新原因与最小方案，不为消除 overlay 直接放宽 CSP 或关闭 HMR overlay。

实际：未执行；本轮只编写文档，未运行 URL 单测或修复后的检测。

## 进度

- 2026-10-28：编写子计划；前次只读诊断已核对 query 注入路径，修复尚未开始。

## 发现与偏差

生产 worker 不含 Vite 开发 helper，故原目录版加载结果不能排除开发模式故障。完整 URL 的方案需由真实 Worker 响应验证，不仅验证字符串或静态文件可下载。

## 交接

草稿，等待后续实施。完成后把实际改动与 URL 测试结果交给 03，集中验证开发和目录版加载；尚无修复证据。
