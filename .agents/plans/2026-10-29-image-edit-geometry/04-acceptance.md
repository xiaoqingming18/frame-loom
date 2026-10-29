# Plan: 集成验收

Status: draft
Parent: plan.md

## 目标

用本地模拟服务证明三项编辑端到端不再变形，旧数据兼容，全量校验通过，并完成笔记与计划收尾。

## 前置条件

- 02、03 完成。
- 构建完成后再启动 E2E，避免并发改写 engine 产物。

## 步骤

- [ ] T1 扩展 `apps/desktop/e2e/image-node-acceptance.test.ts` 的模拟服务，分别返回竖图、方图与错误比例图 — 验证：竖图和方图写回结果尺寸等于源图且无拉伸；错误比例时任务显示后处理失败且模拟服务只收到一次提交
- [ ] T2 加载含旧表情配方（无 `geometry`）的画布与在途任务夹具 — 验证：画布正常打开，任务完成且诊断含降级提示
- [ ] T3 运行 `pnpm run typecheck`、变更文件 ESLint／Prettier、受影响包单测与 `pnpm run verify` — 验证：全部通过并记录实际结果
- [ ] T4 若用户授权费用，用真实 `gpt-image-2.5` 对竖图、横图、多人图各做一次表情编辑，并核实 `/images/edits` 接受自定义尺寸 — 验证：人工对比截图；未授权时标记放弃并写明原因
- [ ] T5 笔记移入 `implemented/bug-fix/` 并改写为现在时，更新 [图片编辑实现](../../notes/implemented/feature/2026-10-28-canvas-image-edit-tools.md) 中的链接；父计划与子计划转 `done` — 验证：`pnpm run verify` 通过

## 验证

- 预期：E2E 与全部校验通过；真实模型验证按授权情况记录。
- 实际：未执行。

## 进度

- 2026-10-29：创建子计划草稿。

## 发现与偏差

无。

## 交接

未开始；等待 02、03 完成。
