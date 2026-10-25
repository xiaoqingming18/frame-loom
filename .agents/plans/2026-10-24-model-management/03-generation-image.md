# Plan: 生成任务内核与图片

Status: done
Parent: plan.md

## 目标

- 建立 `generation_jobs` 任务内核：状态机、调度、退避、并发、启动恢复、`submit_unknown`、取消，以及 SSE 进度推送。
- 结果按 sha256 落盘到 `media/`，并通过 `frame-media://` 在页面中显示。
- 接入三个图片协议：`openai-images`、`gemini-image`、`ark-images`。参考图走内联传输。
- 模型测试页新增图片页签，按能力档案生成参数表单。

## 前置条件

- 02 完成：渠道模型与默认模型可用。

## 步骤

- [x] T1 contracts 定义 `ModelProfile`（模式、参数、约束、输入限制、运行时默认值）、`GenerationRequest`、`GenerationJob`、错误类别，以及 `checkGenerationRequest` — 验证：覆盖约束互斥、联动、数量上限，以及通用档案
- [x] T2 `modules/generation`：
  - 定义 `generation_jobs`、`media_files` 两张表及迁移；
  - 实现状态机与调度器，包括 `next_poll_at`、退避、按渠道模型的并发上限、启动恢复规则、`submit_unknown` 判定、取消、重新提交、重新查询；
  - 请求 JSON 中内联的素材替换为 sha256 引用。

  验证：模拟厂商服务的集成测试覆盖笔记验收第 3 条中与视频无关的各项（提交超时只提交一次、engine 退出后恢复、并发上限、429 退避、下载重试）
- [x] T3 媒体落盘：
  - 流式下载并计算 sha256，先写临时文件再改名；
  - 读取图片尺寸，所选库要精确锁定版本；
  - 同一 sha256 只存一份。

  验证：集成测试中 `media/` 只出现以哈希命名的文件，重复结果不产生新文件
- [x] T4 主进程注册 `frame-media://` 协议：只接受 64 位十六进制 sha256，支持 Range 请求，并更新 CSP — 验证：main 单测覆盖路径注入与非法哈希；开发窗口中 `<img>` 能显示图片
- [x] T5 三个图片适配器与各自的内置档案，加通用图片档案；录制样例放在适配器同目录的 `fixtures/` — 验证：每个协议覆盖成功、审核拒绝、429、鉴权失败
- [x] T6 模型测试页的图片页签：
  - 选择模型后按档案渲染参数表单，不可选项禁用并说明原因；
  - 可以上传参考图；
  - 显示任务列表、实时状态和产物预览；
  - 提供重新提交、重新查询、放弃操作。

  验证：组件测试覆盖约束禁用与 `submit_unknown` 的操作入口；明暗截图检查
- [x] T7 桌面 e2e：在界面添加一个指向模拟服务的渠道，测试连接，在模型测试页生成图片并显示预览 — 验证：`pnpm --filter @frame-loom/desktop test:e2e` 通过

## 验证

- 预期：上述测试，以及 `pnpm typecheck`、`pnpm lint`、`pnpm run verify` 通过；加固 exe 中能显示生成的图片，且没有 CSP 违规。
- 实际：`pnpm test` 通过（contracts 84、desktop 125、engine 130，共 339 项）；`pnpm typecheck`、`pnpm lint`、`pnpm run verify` 通过；`pnpm --filter @frame-loom/desktop test:e2e` 通过（6 项）；开发窗口明暗模式和 720×560 截图已检查；本机 Electron 45 生成 `release/win-unpacked` 加固包并验证构建完成。NSIS/在线 Electron 下载因网络超时未重新生成，包内人工脚本在 Windows 临时 Chromium 数据库清理阶段遇到 EBUSY，功能检查已完成但脚本未能正常收尾。

## 进度

- 2026-10-24：创建子计划草稿。
- 2026-10-25：用户授权执行 03；沿用 02 的未提交实现，开始契约、任务内核、媒体协议与图片页签。
- 2026-10-25：完成 T1～T7；补充 SSE 真实 HTTP 生命周期测试的独立超时，完成开发窗口 e2e、媒体协议测试、三适配器样例测试与本机 Electron 加固包构建。

## 发现与偏差

在线 Electron 下载在 `electron-builder` 阶段连接 GitHub 超时；改用仓库已安装的 Electron 45 本地发行目录完成 `win-unpacked` 构建。加固包检查脚本退出时 Windows 锁定 Chromium 临时数据库，未影响生成、`frame-media://` 预览、主题切换或应用退出断言。

## 交接

03 已完成，02 的未提交改动与本子计划实现共同保留。后续从 04 开始视频、对象存储和 ffprobe；真实供应商冒烟仍留给 05。
