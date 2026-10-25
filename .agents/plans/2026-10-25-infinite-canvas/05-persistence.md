# Plan: 持久化

Status: done
Parent: plan.md

## 目标

- engine `modules/canvas`：`canvas_documents` 表与迁移，`GET /canvases/:id`、`PUT /canvases/:id`（revision、409）、`PUT /canvases/:id/view`。
- renderer 宿主实现：加载、防抖 1 秒保存、离开前保存、保存状态、409 提示重新加载或导出。

## 前置条件

- 03 完成。

## 步骤

- [x] T1 schema、迁移、repository、controller — 验证：engine 集成测试（真实 SQLite）覆盖创建、读取、revision、409、上限与 `data` 校验、视图保存；条件写入直接放 repository，无独立领域逻辑时不增加空 service
- [x] T2 `features/canvas-lab` 宿主的 documents 实现与保存状态 — 验证：组件测试使用替身 client；保存队列覆盖加载失败、1 秒防抖、连续编辑、撤销、视图与 revision、409 与失败重试
- [x] T3 桌面 e2e：保存后重启应用，内容与视口保留 — 验证：两项持久化场景通过，覆盖自动保存、视图独立保存、路由离开、立即关闭、应用退出、409、JSON 救援、引擎退出与放弃后离开；最终构建的全部 12 项桌面 e2e 通过

## 验证

- 预期：engine 集成测试与 e2e 通过。
- 实际：
  - `pnpm --filter @frame-loom/engine exec vitest run src/modules/canvas/canvas.integration.test.ts src/core/database/database.service.test.ts`：8 项通过，使用真实 SQLite 与 HTTP，覆盖迁移、重启、创建／读取、并发 revision、409、节点／连线／UTF-8 字节上限、内置 data、未知类型、非法 id 和视图保存。
  - `features/canvas-lab` 的保存队列与组件测试共 11 项通过；覆盖 1 秒防抖、保存中继续编辑、视图失败不重复提交文档、409 暂停与重载清空历史、加载失败不开放编辑、离开保护和导出入口。撤销回已保存状态的 8 项队列测试另行重跑通过。
  - `pnpm -r --workspace-concurrency=1 test --maxWorkers=1`：全仓 445 项通过（contracts 101、engine 148、canvas 54、desktop 142）。沿用 04 的串行命令，避免已记录的默认并发启动超时。
  - `pnpm build`、`pnpm typecheck`、`pnpm lint`、`pnpm format:check`、`pnpm run verify` 通过。
  - `pnpm --filter @frame-loom/desktop test:e2e`：最终构建的全部 12 项通过，包含两项持久化场景，以及既有节点／媒体／分组／外壳／模型管理与图片生成回归。
  - 已目检 `apps/desktop/test-results/canvas-persistence-*/` 中保存、冲突和 720×560 故障状态的明暗截图，状态、重试与导出按钮可见，无横向溢出。加固 exe 与 06 总体验收未执行。

## 进度

- 2026-10-25：创建子计划草稿。
- 2026-10-25：03、04 已完成，启动持久化开发；复用 contracts 校验、画布 store 和 engine client，不新增依赖。
- 2026-10-25：T1 完成，真实 SQLite 的画布与数据库测试共 8 项通过；宿主保存队列和失败保护已接入，10 项单测通过，正在运行桌面重启回归。
- 2026-10-25：T2 与两项持久化桌面场景完成；覆盖正常关闭、应用退出前尚未结束的标题编辑、409 导出与重载、引擎故障保留、最小窗口和明暗截图；正在完成最终全仓回归。
- 2026-10-26：T1–T3 完成，445 项单测与最终构建的 12 项桌面 e2e 全部通过，类型、lint、格式、笔记／计划校验通过；同步父计划与相关笔记，不新增依赖。

## 发现与偏差

- 沿用渠道模块 repository 的数据库错误映射方式，revision 通过单条条件 UPDATE／INSERT 原子校验；没有可独立承担职责的领域 service，省去纯转发层。
- Nest 默认把 null 返回值写成空响应；画布 GET 显式发送 JSON null，保证不存在的画布符合 contracts。
- 未知节点类型的校验只查内置映射的自有属性，避免合法的 `constructor` 被误当成内置 schema；contracts 回归覆盖该边界。
- Electron 导出测试沿用现有 `session.defaultSession` 的 `will-download` 指定保存路径，并读取实际文件；等待网页 `download` 事件会留下阻塞主进程的原生保存框。失败清理只回收本测试创建的进程，不改用户数据或生产设置。
- 总笔记仍覆盖未完成的 06，因此保持 `proposed`，父计划保持 `active`；不提前迁移整篇笔记或宣称完成节点生成与加固 exe 验收。

## 交接

无。
