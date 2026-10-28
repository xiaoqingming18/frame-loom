# Plan: 图片编辑修复的必要联调与验收

Status: done
Parent: plan.md

## 目标

只用能够证明两项缺陷修复结果的运行验收，确认真实开发 Worker 加载、有效模型能力和生产同源兼容；不重复先前图片编辑功能的完整验收。

## 前置条件

- 01、02 的实现及定向测试通过。
- 阅读 `apps/desktop/e2e/image-node-acceptance.test.ts`、`packages/canvas/src/nodes/image-edit-tools.test.tsx`、模型目录迁移测试及 01／02 实际验证记录。
- 使用临时测试目录和本地模拟图片服务；不调用收费供应商、不用真实用户数据库。

## 步骤

- [x] T1 在现有本地开发服务器／新建的隔离开发运行中打开表情检测并核对 Network／Worker — 验证：实际 `detectFaces` 完成且 Worker 返回 faces 数组（空数组亦代表 loader 成功），loader URL 无 `?import`，loader、WASM 与 tflite 响应成功，console 无模块导入 overlay。
- [x] T2 使用临时旧目录模型档案通过 UI 选择并提交角度／打光，验证表情专属限制 — 验证：三项前端与 engine 结果一致；mock 服务只接收允许的请求；无蒙版路径仍显示既有本地合成降级说明。
- [x] T3 基于修复后的代码完成必要构建和一次 Windows x64 目录包同源资源冒烟 — 验证：`app://frame-loom` 下 loader、WASM、tflite 可取且检测能响应；CSP 无新增 Blob 或远端许可。不得用修复前的旧包充当新证据；失败只定向修复后重验。
- [x] T4 记录必要 UI 和数据证据 — 验证：检查三种操作的代表性可用／拒绝结果与表情面板，不重复明暗主题、720×560 全部控件、整套图片编辑 E2E 或预设截图。
- [x] T5 集中执行一次受影响类型、静态及文档门禁 — 验证：`pnpm run typecheck`、仅对实际变更源码执行 `pnpm exec eslint`、仅对变更文件执行 `pnpm exec prettier --check`、`pnpm run verify` 和 `git diff --check`；不在各子计划重复运行。

## 验证

### 必须执行

- 真实 Vite 开发 Worker 检测：静态文件 200、目录包成功和手动框选都不能替代。
- 一组旧档案 → `/channel-models` → 画布能力门控 → `/generation-jobs` 的模拟跨层检查。
- 生产 `app://` 资源同源检查，确认开发方案没有破坏目录包与 CSP。

### 省略与扩测条件

- 本次只涉及这两条修复时不运行全仓 E2E、NSIS 安装卸载、收费模型、全分辨率／GPU 矩阵、重复视觉截图或其他媒体功能回归。既有专项 E2E 已覆盖角度／打光／表情主路径，本计划不再复制。
- 01／02 若进一步改变任务请求序列化、模型目录 schema 或桌面公共 host，追加直接相关的回归；范围外失败需先核对与本改动的关系，不无差别扩大测试。T5 的一次类型检查覆盖共享契约传播。

实际（2026-10-28，Node.js 24.22.0 / pnpm 12.15.0）：
- engine 构建完成后，`pnpm --filter @frame-loom/desktop exec playwright test e2e/image-edit-runtime.test.ts`：2/2 通过。真实 Vite 与新加固目录包均返回 faces 数组和 256×256，空数组为检测成功，无替身。
- 开发 loader／WASM／tflite 均 200，无 loader import query、pageerror 或 Vite overlay；临时旧目录实际关闭／重启升级后，通过 UI 选择并向本地模拟服务提交角度、打光和表情共 3 次。
- 脱敏档案：旧 openai-images-gpt-image-2.5 缺字段 → angle／lighting／emotion、参考数 3、OpenAI 编辑 true、mask false；gemini-image-default 缺字段 → 角度／打光支持。Gemini 表情在 UI 与 engine 均提示 OpenAI Images 协议要求、422 且无额外请求。无蒙版时原本地脸部融合通知可见。
- `pnpm --filter @frame-loom/desktop package:dir --config.electronDist=node_modules/electron/dist` 成功，复用本机 Electron 45.0.0 生成本次 Windows x64 加固包。生产仅通过 renderer CDP 检查，app 同源三资源 200、Worker 检测成功并正常退出；未改 fuse、未启用主进程 inspect、未放宽 CSP。
- 首次联调读到旧 engine 产物，重建后复验；脚本误将提交后通知当面板提示，改为验证实际提交；生产夹具 OffscreenCanvas 补初始化 2D context。均已定向重验，不扩大产品方案。
- `pnpm run typecheck` 最终通过；首次发现的新增测试联合类型及 Window 桥接类型问题已修正。实际变更源码 ESLint、变更文件 Prettier、`pnpm run verify`（28 篇笔记、75 份计划）及 `git diff --check` 均通过。
- UI 证据：`apps/desktop/test-results/image-edit-runtime-真实-Vite-Worker-检测及旧目录模型的-UI／提交能力一致/emotion-protocol.png`，为忽略的本机产物。为保存截图最后仅重跑开发用例 1/1 通过；无布局改动，不重复主题／小窗矩阵。

## 进度

- 2026-10-28：创建整体验收草稿，未执行构建、浏览器或模型调用。

- 2026-10-28：完成真实开发、旧目录 UI／提交、新目录包检测与代表性 UI 证据。

## 发现与偏差

既有加固目录版曾加载 Worker／WASM／模型并检查人脸检测，但该检查发生在当前开发 query bug 诊断前，也不证明现在的 Vite 开发转换正确。需要保留新开发模式实测。

## 交接

无。用户环境能力根因未核实；使用隔离临时目录和本地模拟服务，未读取或更新用户真实模型目录。
