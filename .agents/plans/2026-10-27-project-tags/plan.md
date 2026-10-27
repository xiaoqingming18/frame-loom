# Plan: 项目标签

Status: done
Note: ../../notes/implemented/feature/2026-10-27-project-tags.md

## 目标

达成[项目标签方案](../../notes/implemented/feature/2026-10-27-project-tags.md)的验收标准：

- 标签列表存放在 `.frameloom/project.json`，内置 7 个标签。用户可以添加、改名、改色和删除自定义标签，内置标签只能删除。
- 图片、视频节点右键菜单出现「标签」，打开的悬浮卡片支持单选打标签、批量打标签、选中态和「移除标签」。
- 删除被引用的标签时，弹窗列出全部创作页中的引用。逐行修改或「全部改为 X」完成后才能删除。
- 打过标签的节点在标题栏右侧显示同色徽标。
- 跨项目粘贴或导入时，按名称匹配标签，匹配不到就清空。

## 范围与非目标

- 范围：
  - `packages/contracts`：标签 schema、`CanvasNode.tagId`、可打标签类型常量。
  - `apps/engine/src/modules/projects`：标签服务与接口。
  - `packages/canvas`：host 接口、store、命令、节点头部、徽标、卡片、剪贴板与导入。
  - `apps/desktop`：标签色 token、宿主注入、删除引用弹窗、e2e。
  - 相关笔记原地同步：项目库、无限画布、共享契约。
- 非目标：
  - 按标签筛选或高亮、小地图或「整理」按标签排序、项目资产 Tab 显示标签。
  - 多标签。
  - 任意取色。
  - 弹窗中跳转到节点。
  - 内置标签恢复入口。
  - `formatVersion` 升级。

## 子计划

| 编号 | 子计划 | 状态 | 依赖 | 交付物 |
| --- | --- | --- | --- | --- |
| 01 | [标签契约](01-contracts.md) | done | — | 标签 schema、内置列表、`tagId` 字段与校验、单测 |
| 02 | [engine 标签接口](02-engine.md) | done | 01 | 标签增删改查、引用扫描、带改派的删除、集成测试 |
| 03 | [画布标签交互](03-canvas.md) | done | 01 | host 接口、store、`setTag` 命令、`NodeHeader` 徽标、标签卡片、剪贴板／导入匹配 |
| 04 | [宿主与删除弹窗](04-desktop.md) | done | 02、03 | 主题 token、`host.tags` 注入、加载清理、删除引用弹窗 |
| 05 | [验收与收尾](05-acceptance.md) | done | 04 | e2e、明暗与小窗口人工检查、笔记转 implemented、计划 done |

## 依赖与顺序

- 关键路径：01 → 03 → 04 → 05。
- 可并行：02 与 03 都只依赖 01。

## 验收

- [x] contracts、engine、canvas、desktop 单测与组件测试通过，`pnpm test`、`pnpm typecheck`、`pnpm lint`、`pnpm format:check` 通过 — 证据：2026-10-27 最终全仓 738 项测试通过，05 验证
- [x] e2e 覆盖两页同标签、删除时全部改派、重启后徽标正确 — 证据：05 标签 e2e 与项目库／持久化回归共 4 项通过
- [x] 明暗、720×560 截图逐图目检，实际 Electron 键盘与焦点路径通过 — 证据：05 验证；不冒充真人物理键盘或读屏检查
- [x] 笔记转入 `implemented/`，相关笔记同步，计划转 `done`，`pnpm run verify` 通过 — 证据：05 收尾

## 发现与偏差

- 01–05 已完成。05 的真实 Electron 标签 e2e、项目库与持久化回归共 4 项通过，明暗、720×560 与长标题徽标截图已逐图目检，键盘／焦点使用实际 Electron 事件验证。标签笔记转为 implemented，保留未复验加固安装包、真人物理键盘与读屏的范围说明。
- 05 发现并修复旧清单普通写入没有补齐默认标签的既有约定偏差；显式 `tags: []` 仍保持空，新增两条真实落盘回归。全仓测试增为 738 项。

## 进度

- 2026-10-27：完成 01 标签契约与 02 engine 标签接口；contracts 191 项、engine 228 项测试通过，typecheck、lint、格式检查和 `pnpm run verify` 通过。
- 2026-10-27：续完 03、04，保留现有实现并补齐交互、标签未加载保护、宿主删除与加载清理回归；全仓 `pnpm test` 736 项（contracts 191、engine 228、canvas 128、desktop 189）、`pnpm typecheck`、`pnpm lint`、`pnpm format:check`、`pnpm run verify` 与 `git diff --check` 均通过。相关活跃笔记已同步事实，修改未提交；下一步执行 05 的 Electron e2e、实际视觉与键盘验收，再完成总笔记生命周期收尾。
- 2026-10-27：完成 05 与总收尾，标签及项目库／持久化 Electron 回归 4 项通过（36.3s），19 张明暗／大小窗口截图逐图目检，真实键盘与焦点路径通过。旧清单普通写入补默认标签及显式空列表回归落地，全仓 738 项、typecheck、lint、format:check、verify 和 diff 检查通过。标签笔记移入 implemented，关联笔记、UI 规范与父子计划同步完成；未提交，未复验加固安装包、真人物理键盘、读屏或中文输入法。
