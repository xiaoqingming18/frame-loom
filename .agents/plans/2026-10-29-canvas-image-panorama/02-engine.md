# Plan: engine 尺寸冻结与接缝后处理

Status: draft
Parent: plan.md

## 目标

`apps/engine` 在创建 `panorama` 任务时冻结 2:1 尺寸；下载后执行可恢复的接缝颜色校正，或在比例不符时输出原图并写诊断，规则见笔记「engine」一节。

## 前置条件

- 01 完成。

## 步骤

- [ ] T1 `generation.service.ts` 的图片编辑分支增加 `panorama`：调用 `planPanoramaSize`，覆盖 `width/height/tier/aspectRatio`，写入 `geometry.expected` — 验证：集成测试断言模拟上游收到的 `size` 为 2880x1440，任务请求含冻结尺寸
- [ ] T2 新建 `apps/engine/src/modules/generation/image-panorama.ts` 实现 `blendPanoramaSeam`（sharp 原始像素，带宽与平滑规则见笔记） — 验证：像素夹具中左右边缘差值从固定值降到 ≤2，带外像素逐字节一致，输入相同则输出确定
- [ ] T3 `download` 复用 `imageEditPostProcess` 中间图／最终图流程处理 `panorama`；比例不符时以中间图为输出并写诊断 — 验证：2:1 返回得到最终图；1:1 返回任务成功、输出等于中间图、诊断存在
- [ ] T4 重启恢复：中间图已存在时只重做本地处理 — 验证：集成测试中供应商提交与下载各只调用 1 次
- [ ] T5 媒体清理保护 `panorama` 配方源图与快照哈希 — 验证：`project-content.integration.test.ts` 新增用例通过

## 验证

- 预期：`pnpm --filter @frame-loom/engine test` 通过；严格模拟上游断言方法、路径和请求次数。
- 实际：未执行。

## 进度

- 2026-10-29：创建子计划草稿。

## 发现与偏差

无。

## 交接

依赖 01，尚未开始。
