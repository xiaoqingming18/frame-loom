# Plan: 共享几何规划与配方字段

Status: done
Parent: plan.md

## 目标

`packages/contracts` 提供 engine 与 canvas 共用的 `planEditGeometry(cap, sourceRect)`，以及 `ImageEditRecipe` 三种操作的可选 `geometry` 字段；行为符合笔记“共享几何规划”与“配方契约”两节。

## 前置条件

- 无。

## 步骤

- [x] T1 在 `packages/contracts/src/` 新建几何模块，实现 pixels＋custom 求解：在 `multipleOf`、`minPixels`、`maxPixels`、`maxEdge`、`maxAspect` 内求同比例宽高，超出 `maxAspect` 时补边到上限比例 — 验证：竖 0.75、横 1.6、极端 0.2 三例结果满足全部限制且比例误差小于 1%
- [x] T2 实现 pixels 无 custom 与 tier／ratio 路径：选最接近的已启用比例并计算四边补边 — 验证：Gemini 模板下 0.7 比例得到 `2:3` 与正确补边
- [x] T3 实现 `none`／`auto` 路径与无可行解报错 — 验证：返回不含尺寸的 `request`；全部比例禁用时抛出带原因错误
- [x] T4 在 `packages/contracts/src/image-edit.ts` 为三种操作增加可选 `geometry`（`crop`、`pad`、`expected`）并导出几何函数；`superRefine` 校验 `crop` 不越过源图 — 验证：现有 `image-edit.test.ts` 通过，新增越界用例被拒绝，缺字段旧配方仍可解析
- [x] T5 编写参数化单测覆盖 OpenAI、无 custom 的 pixels、Gemini、none／auto、超 `maxAspect`、无解 — 验证：`pnpm --filter @frame-loom/contracts test` 通过

## 验证

- 预期：contracts 单测与 `pnpm run typecheck` 通过；旧画布 JSON 中的配方可解析。
- 实际：`pnpm --filter @frame-loom/contracts test` 最终 251 项通过；类型检查通过。

## 进度

- 2026-10-29：创建子计划草稿。
- 2026-10-29：完成全部步骤和定向验证，代码、夹具与决策笔记随本次改动收尾。

## 发现与偏差

Gemini 全模板下 0.7 最近的是 2:3，上下各补 25px；受限 1:1／3:4 夹具才选择 3:4，已按真实最近比例修正原示例。

## 交接

无。
