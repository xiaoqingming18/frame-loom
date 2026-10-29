# Plan: 集成验收

Status: done
Parent: plan.md

## 目标

用本地模拟服务证明三项编辑端到端不再变形，旧数据兼容，全量校验通过，并完成笔记与计划收尾。

## 前置条件

- 02、03 完成。
- 构建完成后再启动 E2E，避免并发改写 engine 产物。

## 步骤

- [x] T1 扩展 `apps/desktop/e2e/image-node-acceptance.test.ts` 的模拟服务，分别返回竖图、方图与错误比例图 — 验证：竖图和方图写回结果尺寸等于源图且无拉伸；错误比例时任务显示后处理失败且模拟服务只收到一次提交
- [x] T2 加载含旧表情配方（无 `geometry`）的画布与在途任务夹具 — 验证：画布正常打开，任务完成且诊断含降级提示
- [x] T3 运行 `pnpm run typecheck`、变更文件 ESLint／Prettier、受影响包单测与 `pnpm run verify` — 验证：全部通过并记录实际结果
- [-] T4 放弃：本次未授权收费供应商调用；若用户授权费用，用真实 `gpt-image-2.5` 对竖图、横图、多人图各做一次表情编辑，并核实 `/images/edits` 接受自定义尺寸 — 验证：人工对比截图；未授权时标记放弃并写明原因
- [x] T5 笔记移入 `implemented/bug-fix/` 并改写为现在时，更新 [图片编辑实现](../../notes/implemented/feature/2026-10-28-canvas-image-edit-tools.md) 中的链接；父计划与子计划转 `done` — 验证：`pnpm run verify` 通过

## 验证

- 预期：E2E 与全部校验通过；真实模型验证按授权情况记录。
- 实际：`pnpm run test` 全部通过：contracts 251、canvas 152、engine 270、desktop 214，共 887 项；`pnpm run build`、`pnpm run typecheck`、`pnpm run lint`、`pnpm run format:check` 通过。构建完成后 `pnpm --filter @frame-loom/desktop test:e2e image-node-acceptance.test.ts` 4/4 通过（48.7s），包含旧节点文档重启补写、竖图、方图、错误比例与只合成重试。旧表情配方画布去除 geometry 后重启可加载；旧在途任务恢复由 engine 集成测试覆盖。`pnpm run verify` 收尾通过（29 篇笔记、1 篇归档封印、89 份计划）。

## 进度

- 2026-10-29：创建子计划草稿。
- 2026-10-29：完成全部开发与本地验收，决策笔记移入 implemented，代码和记录同批收尾。

## 发现与偏差

未授权收费调用，T4 按计划放弃。首轮全量测试中既有渠道并发测试存在提交状态早于 HTTP 到达的竞态，隔离 engine 268/268 与最终全仓 887/887 均通过，没有改动该测试。竖图 E2E 首轮被小地图遮挡，使用产品已有“隐藏小地图”按钮解决。新增截图读取保存记录时增加等待“已保存”，避免读取旧 revision。截图位于 `apps/desktop/test-results/edit-geometry-{lighting,error}-{light,dark}.png`，已检查尺寸预填、错误内容和明暗可读性；没有执行本期加固安装包回归。

## 交接

无。
