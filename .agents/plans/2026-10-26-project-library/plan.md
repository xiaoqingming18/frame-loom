# Plan: 项目库、创作页与项目本地存储

Status: active
Note: ../../notes/proposed/feature/2026-10-26-project-library.md

## 目标

达成[项目库方案](../../notes/proposed/feature/2026-10-26-project-library.md)的验收标准：

- 项目以本地文件夹为准：`.frameloom/` 存清单、创作页和媒体，项目根目录即资产根目录；engine SQLite 只存可重建的注册表和本机视图状态。
- 项目库支持新建、打开已有、搜索、三种排序、重命名、删除（移到回收站或仅移除）、重新定位和不可用状态。
- 项目详情的创作页 Tab 以画布为单位管理页面；项目资产 Tab 支持文件夹、上传、移动、删除、全项目搜索、列表／宫格切换。
- 画布按项目宿主运行：媒体写入项目、跨项目补齐、从资产添加、保存到资产、生成任务归属项目；孤儿媒体自动和手动清理。
- 侧栏列出全部项目及其创作页；画布测试页和 `canvas_documents` 删除；排序与布局偏好跨重启保留。
- UI 对齐 `docs/design/project-library-light.html` 的项目库部分，明暗两种模式通过人工验收。

## 范围与非目标

- 范围：`packages/contracts`（项目、页面、资产、偏好契约与名称规则）、`apps/engine`（`modules/projects`、`ProjectStore`、媒体解析器、生成任务字段、孤儿清理、迁移、删除 `modules/canvas`）、`apps/desktop` 主进程（IPC、`frame-project:` 协议、CSP、偏好合并写入）、preload 与 `lib/desktop-bridge.ts`、renderer `features/projects` 与侧栏、`packages/canvas`（`media.adopt`、`assets`、素材缺失占位）、桌面 e2e 迁移、相关笔记原地同步。
- 非目标：云端项目、账号与同步；文件系统监听；资产缩略图服务；资产「用默认程序打开」；上传文件夹；创作页恢复界面；首页「选择项目」接入；`frame-media://` 与全局媒体目录的删除。

## 子计划

| 编号 | 子计划 | 状态 | 依赖 | 交付物 |
| --- | --- | --- | --- | --- |
| 01 | [契约与名称规则](01-contracts.md) | done | — | contracts 中的项目、页面、资产、偏好 schema 与纯函数单测 |
| 02 | [项目存储与生命周期](02-engine-store.md) | done | 01 | `modules/projects`、`LocalProjectStore`、注册表与页面视图迁移、项目／页面接口与集成测试 |
| 03 | [项目媒体、生成归属与孤儿清理](03-engine-media.md) | done | 02 | 媒体解析器、项目媒体上传／补齐、生成产物入项目与暂存、清理任务 |
| 04 | [项目资产接口](04-engine-assets.md) | done | 02 | 资产列目录、搜索、文件夹、上传、重命名、移动、资产与媒体互转、文件读取接口 |
| 05 | [主进程能力与协议](05-desktop-main.md) | draft | 02、04 | 目录选择、显示、回收站 IPC，`frame-project:` 协议与 CSP，偏好合并写入 |
| 06 | [项目库与详情页界面](06-renderer-library.md) | draft | 05 | `/projects`、新建／打开／重命名／删除对话框、详情页创作页 Tab、侧栏项目树 |
| 07 | [项目资产界面](07-renderer-assets.md) | draft | 06 | 资产 Tab、上传队列、拖放、预览、移动与删除 |
| 08 | [画布接入与画布测试移除](08-canvas-integration.md) | draft | 03、07 | 项目画布路由与宿主、画布包新能力、删除 canvas-lab 与 `modules/canvas` |
| 09 | [验收与收尾](09-acceptance.md) | draft | 08 | e2e 迁移与新增、明暗人工验收、笔记转 implemented、相关笔记同步 |

## 依赖与顺序

- 关键路径：01 → 02 → 04 → 05 → 06 → 07 → 08 → 09。
- 可并行：03 与 04 都只依赖 02；03 需在 08 之前完成。

## 验收

- [ ] `pnpm test`、`pnpm typecheck`、`pnpm lint`、`pnpm format:check`、`pnpm run verify` 通过 — 证据：各子计划验证
- [ ] engine 集成测试覆盖笔记验收标准第 2 条全部场景 — 证据：02、03、04 验证
- [ ] 桌面 e2e 覆盖项目、创作页、资产、画布联动、删除与重启保留，原画布 e2e 改走项目路径后通过 — 证据：09 验证
- [ ] 开发版与加固 exe 明暗人工验收通过，720×560 不溢出，键盘可操作 — 证据：09 验证
- [ ] 笔记转入 `implemented/`，无限画布、主题与外壳、模型管理、桌面壳、应用骨架、共享契约、engine 服务笔记原地同步，计划转 `done` — 证据：09 收尾

## 发现与偏差

- 2026-10-26：用户授权并完成 01、02；全仓 589 项测试、typecheck、lint 通过。总计划保留 active，03–09 尚未实施，总笔记保留 proposed，避免把项目界面和媒体接入描述为已完成。
- 2026-10-26：完成 03、04；全仓 598 项测试、typecheck、lint 通过。新增 0007 迁移追踪待复制产物，schema_version 为 3；资产文件发布要求支持硬链接。总笔记仍为 proposed，05–09 尚未实施。
- 下一步从 05（主进程能力与协议）继续；接口与字段说明见 `apps/engine/README.md`。复用 `ProjectStore.serial(projectId, operation)`，不能嵌套等待同一项目队列。桌面画布必须先打开会话、完成保存后关闭会话，以保证清理避让。
