# Plan: 验收与收尾

Status: done
Parent: plan.md

## 目标

- 桌面 e2e 覆盖笔记验收第 4 条。
- 开发版与加固 exe 明暗人工验收覆盖笔记验收第 5 条。
- 笔记转入 `implemented/feature/`，无限画布、模型管理笔记原地同步，计划转 `done`。

## 前置条件

- 05 完成。

## 步骤

- [x] T1 e2e：模拟供应商下 ×3 生成写回 3 个版本、令其中一个失败后单张重试 — 验证：`pnpm --filter @frame-loom/desktop test:e2e`
- [x] T2 e2e：切换模型回退、@ 引用后请求的提示词与 `inputs` 编号一致、含 `pendingJobId` 的旧文档打开后补写 — 验证：同上
- [x] T3 人工验收：对照 `docs/design/canvas-image-node.html`，明暗模式、720×560、键盘、中文输入法 — 验证：截图与记录保存到 `.cache/canvas-image-node/`
- [x] T4 全仓门禁 — 验证：`pnpm test`、`pnpm typecheck`、`pnpm lint`、`pnpm format:check`、`pnpm run verify`
- [x] T5 收尾：笔记移入 `implemented/feature/` 并改写为现在时，同步[无限画布](../../notes/implemented/feature/2026-10-25-infinite-canvas.md)与[模型管理](../../notes/proposed/architecture/2026-10-24-model-management.md)，修正 `docs/design/README.md` 链接，父子计划转 `done` — 验证：`pnpm run verify`

## 验证

- 预期：e2e、人工验收与全仓门禁通过。
- 实际：`pnpm test` 通过 527 项（contracts 141、engine 161、canvas 89、desktop 136）；`pnpm typecheck`、`pnpm lint`、`pnpm format:check` 通过。`pnpm --filter @frame-loom/desktop test:e2e` 完整 13 项通过，包含新增模型回退、双参考中英文编号与旧文档重启补写；日志见 `.cache/canvas-image-node/e2e-final-pass.log`。笔记与计划校验日志见 `.cache/canvas-image-node/verify-final.log`。
- 开发版与加固 exe 均完成明暗主题、1500×960 与 720×560、四种弹层键盘操作及原生中文输入法上屏“你”；未发现页面或 CSP 错误。大窗口输入框 620×227，小窗口 427×227，边界与截图见 `.cache/canvas-image-node/layout-results.json` 和 `acceptance.md`。
- `pnpm package:prepare` 通过，electron-builder 使用本机同版本 Electron 完成目录包，asar integrity 与 fuses 加固均执行；验收对象为 `apps/desktop/release/win-unpacked/Frame Loom.exe`。

## 进度

- 2026-10-26：创建子计划草稿。
- 2026-10-26：新增独立模拟供应商验收，完成两环境明暗、小窗口、键盘与本机原生输入法检查；补齐既有测试的选中遮挡和布局动画等待，证据保存到 `.cache/canvas-image-node/`。
- 2026-10-26：完整 13 项桌面回归通过；图片笔记转 implemented 并同步关联笔记与链接，父子计划收尾；保留原有 05 工作区改动，未自动提交。

## 发现与偏差

- 既有连线用例双击位置被选中节点输入框遮挡，改为取消选择后双击。窗口缩放、弹层展开及虚拟化节点切换期间直接取坐标或按键会产生竞态，测试等待对应布局完成；未为通过测试修改产品代码。
- 一轮 e2e 与原生窗口验收并发导致焦点干扰，不作为通过证据，最终整套串行重跑。失败日志保留在本地验收目录。
- 首次 Electron 下载遇到 ECONNRESET，改用已安装的同版本 Electron 构建目录包，未改打包配置。未制作 NSIS、未签名或发布；真实供应商冒烟仍归模型管理验收。原生输入法结论仅覆盖本机当前输入法。

## 交接

无。
