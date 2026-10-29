# Plan: 共享几何规划与配方字段

Status: draft
Parent: plan.md

## 目标

`packages/contracts` 提供 engine 与 canvas 共用的 `planEditGeometry(cap, sourceRect)`，以及 `ImageEditRecipe` 三种操作的可选 `geometry` 字段；行为符合笔记“共享几何规划”与“配方契约”两节。

## 前置条件

- 无。

## 步骤

- [ ] T1 在 `packages/contracts/src/` 新建几何模块，实现 pixels＋custom 求解：在 `multipleOf`、`minPixels`、`maxPixels`、`maxEdge`、`maxAspect` 内求同比例宽高，超出 `maxAspect` 时补边到上限比例 — 验证：竖 0.75、横 1.6、极端 0.2 三例结果满足全部限制且比例误差小于 1%
- [ ] T2 实现 pixels 无 custom 与 tier／ratio 路径：选最接近的已启用比例并计算四边补边 — 验证：Gemini 模板下 0.7 比例得到 `3:4` 与正确补边
- [ ] T3 实现 `none`／`auto` 路径与无可行解报错 — 验证：返回不含尺寸的 `request`；全部比例禁用时抛出带原因错误
- [ ] T4 在 `packages/contracts/src/image-edit.ts` 为三种操作增加可选 `geometry`（`crop`、`pad`、`expected`）并导出几何函数；`superRefine` 校验 `crop` 不越过源图 — 验证：现有 `image-edit.test.ts` 通过，新增越界用例被拒绝，缺字段旧配方仍可解析
- [ ] T5 编写参数化单测覆盖 OpenAI、无 custom 的 pixels、Gemini、none／auto、超 `maxAspect`、无解 — 验证：`pnpm --filter @frame-loom/contracts test` 通过

## 验证

- 预期：contracts 单测与 `pnpm run typecheck` 通过；旧画布 JSON 中的配方可解析。
- 实际：未执行。

## 进度

- 2026-10-29：创建子计划草稿。

## 发现与偏差

无。

## 交接

未开始；从 T1 开始，先阅读 `packages/contracts/src/image-size.ts` 与 `protocols.ts` 中各模板的 `size` 定义。
