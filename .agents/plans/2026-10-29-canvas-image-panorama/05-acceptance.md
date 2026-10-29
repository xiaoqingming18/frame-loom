# Plan: 集成验收

Status: done
Parent: plan.md

## 目标

用本地模拟服务和桌面 E2E 证明转全景、查看、截图整条链路可用，完成全量校验，并把笔记移入 `implemented/`。

## 前置条件

- 02、03、04 完成。

## 步骤

- [x] T1 E2E：OpenAI 模板模拟返回 2:1 PNG → 子节点显示角标 → 打开查看器 → 当前视角截图生成 16:9 节点 — 验证：截图节点尺寸与连线正确
- [x] T2 E2E：模拟返回 1:1 PNG → 任务成功、诊断可见、无角标 — 验证：断言通过
- [x] T3 开发模式与 Windows 目录包中加载 `frame-media://` 纹理 — 验证：两种环境都能显示全景，控制台没有 CORS／CSP 错误
- [x] T4 全量校验 — 验证：`pnpm run typecheck`、`pnpm run lint`、`pnpm run format:check`、`pnpm run build`、`pnpm test`、`pnpm run verify` 通过
- [x] T5 收尾：笔记改写并移入 `implemented/feature/`，在图片编辑工具笔记补关联，计划转 `done` — 验证：`pnpm run verify` 通过

## 验证

- 预期：上述命令与 E2E 通过；不调用真实模型。
- 实际：`pnpm test` 全仓 903 项通过，随后新增两项 canvas 计划专项测试及节点比例提示后，canvas 163 项全量通过（各包当前合计 905 项）。typecheck、lint、format:check、build 与 `pnpm run verify` 通过。`pnpm --filter @frame-loom/desktop test:e2e e2e/panorama.test.ts` 开发模式 1/1 通过；设置 `FRAME_LOOM_E2E_PANORAMA_PACKAGE=1` 的同一 E2E 在最终加固目录包 1/1 通过，均只发送两次本地模拟请求、无页面／CORS／CSP 错误。
- 像素与布局：五张 1536×864 截图、六条连线，四向截图一次撤销回到三节点；中心／地面像素与 sRGB 色值正确；方图保留输出且画布提示可见。明暗面板、查看器及 720×560 截图已查看，保存在 `apps/desktop/test-results/`（忽略产物，不提交）。
- 构建：先运行 `pnpm run package:prepare`，再运行 `pnpm --filter @frame-loom/desktop exec electron-builder --win --x64 --dir --publish never --config.electronDist=../../node_modules/.pnpm/electron@45.0.0_supports-color@7.2.0/node_modules/electron/dist`；输出 `apps/desktop/release/win-unpacked/Frame Loom.exe`，正常执行 asar 完整性和 fuses。
- 笔记已移入 implemented 并补图片编辑工具关联；父子计划均完成。未调用收费模型，不声称实际供应商全景质量已验收。

## 进度

- 2026-10-29：创建子计划草稿。

- 2026-10-29：模拟生成、查看与截图 E2E，明暗／最小窗口检查、全仓检查和最终加固目录包验收完成。

## 发现与偏差

- 项目实际使用 `frame-project://`，E2E 同时验证项目查看器和全局 `frame-media://` 纹理。
- 在线打包下载 Electron 网络超时，以本地同版本运行时完成打包，不修改仓库构建配置。
- 真实渲染检查补齐 ImageBitmap 翻转和离屏 sRGB；成功任务引用移除后，方图诊断由活动版本比例在节点持续显示。
- 首轮主题模拟、焦点、上传类型及并发重建产物导致的测试失败已修正；最终开发与目录包均通过。

## 交接

无。
