# Plan: 验收与收尾

Status: done
Parent: plan.md

## 目标

用端到端测试和截图目检证明标签功能完整可用，同步相关笔记，并将笔记与计划转入完成状态。

## 前置条件

- 04 完成。

## 步骤

- [x] T1 新增 `apps/desktop/e2e/project-tags.test.ts`：
  - 在两个创作页给节点打同一个标签，在其中一页删除该标签。
  - 弹窗「全部改为」其他标签后删除成功。
  - 重启后两页徽标正确。
  - 自定义标签改名、改色后，另一页同步显示。
  - 覆盖锁定引用改派、真实 409 后刷新并重新选择、清单落盘。

  — 验证：`pnpm --filter @frame-loom/desktop test:e2e project-tags` 通过
- [x] T2 在真实 Electron 中检查明暗两种模式、1120×760 和 720×560，截图存入 `.cache/project-tags/` 并逐图核对；以实际键盘事件验证菜单 → 卡片 → 编辑和删除图标 → 弹窗，锁定节点画布菜单置灰、删除弹窗可改派及错误状态 — 验证：下方截图清单与键盘断言；不以自动事件冒充真人物理键盘或读屏验收
- [x] T3 原地同步[项目库](../../notes/implemented/feature/2026-10-26-project-library.md)的清单格式、[无限画布](../../notes/implemented/feature/2026-10-25-infinite-canvas.md)的 host 和节点头部、[共享契约](../../notes/implemented/architecture/2026-10-24-shared-contracts.md)，以及 `docs/ui-guidelines.md` 的标签 token 说明 — 验证：`pnpm run verify`
- [x] T4 将[项目标签笔记](../../notes/implemented/feature/2026-10-27-project-tags.md)移入 `implemented/feature/`，并改写为现在时；父子计划转 `done` — 验证：`pnpm test`、`pnpm typecheck`、`pnpm lint`、`pnpm format:check`、`pnpm run verify`

## 验证

- 预期：全仓门禁与 e2e 通过，截图逐图目检与实际 Electron 键盘路径完成。
- 实际（2026-10-27，Node 24.22.0 / pnpm 12.15.0）：
  - `pnpm --filter @frame-loom/engine... build`、`pnpm --filter @frame-loom/desktop build` 通过。
  - `pnpm --filter @frame-loom/desktop test:e2e project-tags` 通过，1 项；重启检查两页全部引用为「最终版」，并核对磁盘清单。
  - `pnpm test` 738 项通过（contracts 191、engine 230、canvas 128、desktop 189）；`pnpm typecheck`、`pnpm lint` 通过。
  - `pnpm --filter @frame-loom/desktop test:e2e project-tags canvas-persistence project-library` 共 4 项通过（36.3s），补充项目库与保存、故障恢复回归。
  - `pnpm format:check`、`pnpm run verify`、`git diff --check` 通过。
- 截图清单（均在 `.cache/project-tags/`）：
  - `card-{light,dark}-{1120,720}.png`：列表、选中态、输入和添加控件、滚动区均可见。
  - `edit-{light,dark}-{1120,720}.png`：键盘焦点令行内图标显现，名称、10 色色板及保存按钮不溢出。
  - `delete-{light,dark}-{1120,720}.png`：两页引用、缩略图、锁定图标、逐行和全部改派控件完整可见；未全部选择时删除禁用。
  - `badge-{light,dark}-{1120,720}.png`：重启后的徽标颜色和文字正确，长标题先截断，不挤掉徽标。
  - `locked-menu.png`：锁定节点的标签菜单置灰。
  - `name-conflict-dark-720.png`、`delete-conflict-dark-720.png`：名称重复、引用变化后错误就地显示，不截断删除操作区。
- 键盘使用实际 Electron 的 Home／方向键／Enter 进入菜单和卡片，Tab 到编辑、色板、保存、删除；Space 选色；删除 Dialog 保有焦点；原生下拉使用 Alt+ArrowDown → End → ArrowUp → Enter 完成全部改派。Esc 关闭卡片后焦点回画布。
- 范围边界：视觉证据是 Agent 对实际窗口截图的逐图目检；没有真人物理键盘、读屏或原生中文输入法复验，没有重打加固安装包或复验其 CSP。

## 进度

- 2026-10-27：创建子计划草稿。
- 2026-10-27：激活 05，新增隔离临时项目的真实 Electron 验收及截图；完成跨页增改、锁定、删除改派、409 刷新、磁盘与重启检查，并同步关联笔记与 UI 规范。补齐旧清单普通写入默认标签的既有约定与两条落盘回归；全仓 738 项、类型与 lint 通过。

## 发现与偏差

- 原计划命令使用不存在的 `e2e` script，改为项目现有的 `test:e2e`。
- 环境继承 `ELECTRON_RUN_AS_NODE=1` 会令 Electron 拒绝 `--remote-debugging-port`；运行 e2e 前仅对当前 PowerShell 进程执行 `Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue`。不修改应用启动方式或用户全局环境。
- Playwright 默认的媒体模拟会遮蔽 nativeTheme；截图前调用 `page.emulateMedia({ colorScheme: null })`，再通过正式主题桥接切换明暗。
- 旧清单的普通写入未补齐默认标签，与既有笔记约定不符；`LocalProjectStore.writeManifest` 复用 `projectTags` 补齐，保留显式空数组。回归先证实缺省情况失败，修复后 engine 230 项通过。
- `apply_patch` 工具及 CLI 均不可用，沿用现有 `edit`／`write` 定点修改，不安装新编辑工具。

## 交接

无。
