# Plan: 无限画布

Status: done
Note: ../../notes/implemented/feature/2026-10-25-infinite-canvas.md

## 目标

达成[无限画布方案](../../notes/implemented/feature/2026-10-25-infinite-canvas.md)的验收标准：

- `packages/canvas` 提供可复用的画布编辑器，`packages/ui` 承载 shadcn 组件；desktop 左栏「画布测试」页面挂载画布供人工验收。
- 图片、视频节点经注册表声明端口，连线按数据类型、结构规则校验；视频节点按文生视频、首尾帧、参考生视频决定端口。
- 底部操作栏、右上工具组、小地图、快捷键、复制粘贴、撤销重做、分组、整理、连线显示均可用，明暗主题正确。
- 画布持久化到 engine，engine 退出不再整页重载。
- 节点内生成写回为新版本，验收后删除模型测试页，笔记转入 `implemented/`。

## 范围与非目标

- 范围：`packages/ui`、`packages/canvas`、`packages/contracts` 的画布契约与 `engine:exited` 载荷、`apps/engine` 的 `modules/canvas`、`apps/desktop` 主进程菜单与退出事件、preload、renderer 的 `features/canvas-lab`、外壳与侧栏、ESLint 与 Tailwind 扫描配置、相关笔记的原地同步。
- 非目标：文本、音频、导演台、视频剪辑节点；项目管理与项目关联；对齐线、对齐均分、按依赖分层整理；缩略图服务；孤儿媒体清理；多人协作；Agent 写画布的命令接口。

## 子计划

| 编号 | 子计划 | 状态 | 依赖 | 交付物 |
| --- | --- | --- | --- | --- |
| 01 | [预备：退出事件、应用菜单、UI 包](01-foundation.md) | done | — | `engine:exited` 事件替代重载；默认菜单移除；`packages/ui` 纯迁移 |
| 02 | [画布骨架](02-canvas-shell.md) | done | 01 | `packages/canvas`、`/canvas-lab` 页面、视口、工具、操作栏、右上工具组、小地图、快捷键层 |
| 03 | [节点与连线](03-nodes-edges.md) | done | 02 | 注册表、图片／视频节点、连线校验、复制粘贴、撤销重做、连线显示 |
| 04 | [分组与整理](04-organize.md) | done | 03 | 分组解组、四种整理、右键菜单、锁定与层级、导出导入 |
| 05 | [持久化](05-persistence.md) | done | 03 | engine `modules/canvas`、自动保存、409 处理、视图状态 |
| 06 | [节点内生成与验收](06-generation-acceptance.md) | done | 04、05 | 节点内生成与版本写回、删除模型测试页、人工验收、笔记收尾 |

## 依赖与顺序

- 关键路径：01 → 02 → 03 → 05 → 06。
- 可并行：04 与 05 都只依赖 03，可以交替推进。

## 验收

- [x] contracts、画布包、engine 集成与 desktop 单测通过，`pnpm test`、`pnpm typecheck`、`pnpm lint`、`pnpm format:check` 通过 — 证据：各子计划验证；06 全仓 449 项串行单测通过
- [x] 桌面 e2e 覆盖建节点、合法与非法连线、切换方式断线与撤销、重启后保留 — 证据：03、05 验证
- [x] 人工验收 7 项在开发环境与加固 exe 中通过，明暗模式均检查 — 证据：06 验证；原生拖入由用户确认，固定性能负载与孤立长帧边界如实记录
- [x] 模型测试页已删除，笔记转入 `implemented/`，相关笔记原地同步，计划转为 `done` — 证据：06 收尾

## 发现与偏差

- 01–05 已完成；全仓 445 项串行单测、最终构建的 12 项桌面 e2e 通过，含文档／视图重启保留、409 恢复与 engine 故障保护，见 [05 验证](05-persistence.md)。默认并发单测的 engine 启动超时记录仍见 [04 验证](04-organize.md)，本轮不扩大范围修改测试超时。
- 06 已完成节点内生成与版本写回、模型测试页删除与测试迁移；开发版与最终加固 exe 的明暗验收完成，最终完整 12 项 e2e 通过，笔记与父子计划收尾。500 节点／50 视频使用重复的 256×256 图片与短视频，全新进程持续交互 P95 约 16.8ms；开发版全览孤立长帧、热更新长期会话和独立 4K 等未覆盖边界见 06 与笔记，不外推为任意负载保证。
