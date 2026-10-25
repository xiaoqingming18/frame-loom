# Plan: 无限画布

Status: active
Note: ../../notes/proposed/feature/2026-10-25-infinite-canvas.md

## 目标

达成[无限画布提案](../../notes/proposed/feature/2026-10-25-infinite-canvas.md)的验收标准：

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
| 04 | [分组与整理](04-organize.md) | draft | 03 | 分组解组、四种整理、右键菜单、锁定与层级、导出导入 |
| 05 | [持久化](05-persistence.md) | draft | 03 | engine `modules/canvas`、自动保存、409 处理、视图状态 |
| 06 | [节点内生成与验收](06-generation-acceptance.md) | draft | 04、05 | 节点内生成与版本写回、删除模型测试页、人工验收、笔记收尾 |

## 依赖与顺序

- 关键路径：01 → 02 → 03 → 05 → 06。
- 可并行：04 与 05 都只依赖 03，可以交替推进。

## 验收

- [ ] contracts、画布包、engine 集成与 desktop 单测通过，`pnpm test`、`pnpm typecheck`、`pnpm lint`、`pnpm format:check` 通过 — 证据：各子计划验证
- [ ] 桌面 e2e 覆盖建节点、合法与非法连线、切换方式断线与撤销、重启后保留 — 证据：03、05 验证
- [ ] 人工验收 7 项在开发环境与加固 exe 中通过，明暗模式均检查 — 证据：06 验证
- [ ] 模型测试页已删除，笔记转入 `implemented/`，相关笔记原地同步，计划转为 `done` — 证据：06 收尾

## 发现与偏差

- 03 已完成并通过节点／连线及媒体导入桌面验证；04、05 尚未启动，重启保留和总体验收未完成。并发单测中的既有 engine 启动超时及串行通过结果见 [03 验证](03-nodes-edges.md)。
