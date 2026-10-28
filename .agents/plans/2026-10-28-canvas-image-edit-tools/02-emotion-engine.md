# Plan: 表情工件与可恢复合成

Status: done
Parent: plan.md
Note: ../../notes/implemented/feature/2026-10-28-canvas-image-edit-tools.md

## 目标

engine 接收并校验冻结的表情编辑快照，制作编辑裁切／身份参考／蒙版，执行协议请求，并在任务恢复后幂等地产生最终源图尺寸整图；后处理失败不得重发模型任务。

## 前置条件

- 01 完成并稳定编辑配方、能力及媒体引用契约。
- 阅读 `apps/engine/src/modules/generation/generation.service.ts`、`media.service.ts`、`generation.schema.ts`、`adapters/openai-images.ts`、`apps/engine/package.json` 和现有恢复集成测试。
- 施工前确认图像处理能力与 Windows 目录打包的最小实现方式；如果需要的原生依赖／资源方式影响已确认边界，先停下向用户说明。

## 步骤

- [x] T1 实现并测试编辑区域钳制、裁切、身份参考图与透明椭圆蒙版 — 验证：小型合成夹具覆盖正常脸、图像贴边和无效尺寸。
- [x] T2 按 OpenAI Images 能力发送编辑裁切、身份参考图及可选蒙版 — 验证：adapter 请求体测试断言输入顺序、mask 关联和无蒙版时字段缺席。
- [x] T3 将最终缩放、羽化、色彩校正与任务处理中间态纳入 engine 可恢复阶段 — 验证：少量确定性像素夹具证明椭圆外保留源像素、最终尺寸与源图相等。
- [x] T4 覆盖合成失败、进程重启、重试和取消边界 — 验证：一次恢复集成场景断言最终整图仅写回一次且供应商提交计数不增加。

## 验证

- 预期：engine 的图像处理纯函数／adapter 定向测试及一项恢复集成测试；不重复整个 generation recovery 矩阵。
- 仅对受影响的 engine 产物格式／尺寸识别路径补充必要断言。
- 实际：`pnpm --filter @frame-loom/engine test -- src/modules/generation/image-emotion.test.ts`（2 passed）；adapter multipart 和 `generation.integration.test.ts -t "表情后处理失败"` 定向测试通过。故障注入覆盖失败后本地重试、模拟启动恢复、最终 SHA 复用和供应商 POST 单次。

## 进度

- 2026-10-28：加入 sharp 工件生成及 engine 幂等最终合成；下载中间图不进入 outputs/stagedOutputs，恢复优先复用 final SHA。

## 发现与偏差

- 为复刻椭圆羽化和边缘颜色校正，采用 sharp 做裁切／像素缓冲处理；用户已授权依赖，Windows x64 预编译二进制加载验证通过。真实目录包还需在 05 检查。

## 交接

无；完整 desktop 目录包及三功能 E2E 汇总由 05 验收。
