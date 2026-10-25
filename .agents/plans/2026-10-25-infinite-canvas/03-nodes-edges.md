# Plan: 节点与连线

Status: done
Parent: plan.md

## 目标

- `packages/contracts/src/canvas.ts` 定义 `CanvasDocument`、`CanvasView` 与上限。
- 节点注册表 `defineNodeType`；图片节点与视频节点（文生视频、首尾帧、参考生视频）按提案声明端口。
- 连线校验：数据类型、自连、重复、成环、端口条数、分组不可连线；拖线到空白处弹出过滤后的添加菜单；切换视频方式时断开不兼容连线并合并为一步撤销。
- 上传、拖入、粘贴图片和视频文件建节点；视频封面抽帧上传；视频按需挂载播放器。
- 复制、剪切、粘贴、原地复制、删除、重命名、微移；撤销重做（快照，上限 100）；连线三档显示。

## 前置条件

- 02 完成。

## 步骤

- [x] T1 contracts 画布 schema 与单测 — 验证：contracts 测试覆盖合法、非法、上限与父子顺序
- [x] T2 注册表、端口兼容与结构校验纯函数及单测 — 验证：校验单测
- [x] T3 命令层与历史栈及单测 — 验证：命令与历史单测
- [x] T4 图片、视频节点视图与上传、拖入、粘贴、封面 — 验证：组件测试；真实 Electron 开发源与构建产物检查，人工核对明暗主题截图
- [x] T5 剪贴板序列化与单测；快捷键接入编辑命令 — 验证：剪贴板单测
- [x] T6 桌面 e2e：建节点、合法与非法连线、切换方式断线与撤销 — 验证：`pnpm --filter @frame-loom/desktop test:e2e`

## 验证

- 预期：上述单测与 e2e 通过。
- 实际：`pnpm -r --workspace-concurrency=1 test` 全仓 417 项通过（contracts 101、canvas 41、engine 144、desktop 131）；`pnpm typecheck`、`pnpm lint`、`pnpm format:check`、`pnpm run verify` 通过。
- `pnpm --filter @frame-loom/desktop build` 通过；`pnpm --filter @frame-loom/desktop test:e2e` 9 项通过，新增两项覆盖连线类型／重复／成环／限额、拖线空白过滤建节点及一步撤销、方式切换、连线显示三档、双格式剪贴板、上传／拖入／粘贴、WebP 封面落盘和单播放器。
- 临时启动 Vite 开发服务器，将真实 Electron 的 `ELECTRON_RENDERER_URL` 指向 `http://127.0.0.1:<临时端口>`；视频导入、WebP 封面和明暗主题均通过，无页面异常，结束后关闭服务并删除临时用户数据。
- 已人工核对 `apps/desktop/test-results/canvas-nodes-*/canvas-{nodes,media}-{light,dark}.png` 的节点、端口和媒体预览。资源管理器拖入、系统剪贴板和中文输入法的真人操作、加固 exe 与大规模性能验收仍由 06 执行。

## 进度

- 2026-10-25：创建子计划草稿。
- 2026-10-25：完成 T1～T6，补齐既有草稿的文档／剪贴板边界、上传占位与取消重试、视频封面与按需播放器；全仓单测、构建、类型、规范及真实桌面验证通过。

## 发现与偏差

- 02 已包含节点、命令和快捷键草稿，本阶段复用并补齐边界，未另起一套编辑流程。
- Portal 菜单的点击会沿 React 树冒泡；画布抢焦点导致菜单提前关闭。仅对实际 DOM 子元素抢焦点后，空白双击和拖线添加均通过。
- 视频抽帧要求 `frame-media` 启用 CORS；协议只返回当前可信 renderer origin，未放宽 CSP，也不反射外部 Origin。
- `pnpm test` 并发运行时，既有 engine 启动测试两次触发默认 5 秒超时，失败分别落在独立启动和无配置退出用例。按包串行运行后全通过；未修改 engine 测试超时或产品代码。
- T4 的开发环境真人操作改为真实 Electron 自动交互和截图人工核对；完整人工矩阵留在 06，未宣称已完成。

## 交接

无。03 已完成，04 与 05 可继续；整体笔记保留 proposed，待 06 总体验收后统一收尾。
