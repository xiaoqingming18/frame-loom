# Plan: 画布图片节点转 720° 全景图

Status: done
Note: ../../notes/implemented/feature/2026-10-29-canvas-image-panorama.md

## 目标

图片节点可以用通用图像编辑模型把当前活动版本转成严格 2:1 的等距柱状全景，并作为子节点写回；任意 2:1 图片都可以在全景查看器里查看，并截取当前视角或四向视角，生成新的图片节点。验收标准见笔记 `## Testing`。

## 范围与非目标

- 范围：`packages/contracts`（`panorama` 配方、`planPanoramaSize`、`imageEditSupport`）；`apps/engine/src/modules/generation/`（创建任务尺寸冻结、接缝颜色校正后处理、比例诊断）；`packages/canvas/src/nodes/`（全景入口与面板、提示词、720° 角标、查看器、截图建节点命令）；本地模拟服务 E2E。
- 基线：`512a00a`。开始实施时重新读取相关文件，不依赖笔记里的行号。
- 非目标：专门全景协议（腾讯云 VOD、fal HunyuanWorld）；ERP 投影外扩；接缝二次重绘；导演台与环境球；超分；HDR／EXR 导入；收费供应商调用。

## 子计划

| 编号 | 子计划 | 状态 | 依赖 | 交付物 |
| --- | --- | --- | --- | --- |
| 01 | [全景配方与尺寸规划](01-contracts.md) | done | — | `panorama` 配方分支、`planPanoramaSize`、能力判定与单测 |
| 02 | [engine 尺寸冻结与接缝后处理](02-engine.md) | done | 01 | 任务冻结 2:1 尺寸、接缝颜色校正、比例诊断、可恢复后处理 |
| 03 | [转全景入口与提示词](03-canvas-generate.md) | done | 01 | 图片节点「全景」面板、提示词、子节点创建 |
| 04 | [全景查看与截取视角](04-canvas-viewer.md) | done | — | 720° 角标、按需加载的查看器、当前视角／四向截图建节点 |
| 05 | [集成验收](05-acceptance.md) | done | 02、03、04 | 模拟服务 E2E、目录包纹理加载、全量校验与笔记收尾 |

## 依赖与顺序

- 关键路径：01 → 02 → 05；01 → 03 → 05。
- 可并行：04 只依赖已有图片节点和 `three`，可与 01～03 并行；02 与 03 在 01 完成后互不依赖。
- 环境：Node.js 24.22.x 与锁定 pnpm；定向测试前先执行 `pnpm --filter @frame-loom/contracts build`。

## 验收

- [x] 尺寸规划在 OpenAI、Seedream、Gemini 默认模板及手工 2:1 能力卡下给出合法 2:1 尺寸或明确原因，前后端一致 — 证据：01 单测
- [x] 接缝校正降低边缘差值、带外像素不变；比例不符输出原图并诊断；重启恢复不重发请求 — 证据：02 像素夹具与集成测试
- [x] 全景入口、模型兼容、子节点与撤销符合笔记 — 证据：03 组件测试
- [x] 查看器加载、交互、释放上下文；截图尺寸正确并建节点 — 证据：04 单测与 05 E2E
- [x] 模拟服务 E2E、明暗主题截图、目录包纹理加载；`pnpm run typecheck`、lint、format:check、build、test、`pnpm run verify` 通过 — 证据：05
- [x] 笔记移入 `implemented/`，图片编辑工具笔记补关联，计划转 `done` — 证据：05 收尾提交

## 发现与偏差

- 项目画布媒体 URL 实际为 `frame-project://`，全局仍用 `frame-media://`；按宿主 URL 验证两种路径，不改协议和 CSP。
- 在线打包下载 Electron 超时，目录包改用本地已安装的 Electron 45.0.0；asar 完整性与 fuses 仍按原配置执行。
