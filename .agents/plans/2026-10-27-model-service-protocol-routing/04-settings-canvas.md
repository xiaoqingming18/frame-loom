# Plan: 模型接入设置与画布状态呈现

Status: draft
Parent: plan.md

## 目标

让用户明确配置模板、有效地址、协议与能力，看到验证层级和任务恢复状态。

## 前置条件

01～03 完成且取得实施授权。阅读 `docs/ui-guidelines.md`、`apps/desktop/src/renderer/src/features/model-services/model-services.tsx`、`labels.ts`、`features/model-management.test.tsx` 及 `packages/canvas` 生成面板与任务状态实现。沿用语义 token、shadcn、lucide。

## 步骤

- [ ] T1 增加模型接入模板、地址继承／覆盖和能力档案编辑，说明渠道 API 格式的真实作用 — 验证：同渠道文本／视频不同域名可一次事务保存，取消编辑不改配置。
- [ ] T2 提供高级操作路径与统一解析器生成的地址预览，显示模板版本及能力更新差异 — 验证：预览与实际请求一致，非法配置不能保存，切换模板不静默覆盖已有设置。
- [ ] T3 区分本地校验、目录权限与真实生成验证，更新媒体测试入口 — 验证：文本或目录成功不显示媒体已通过；真实生成入口明确计费且不因保存自动触发。
- [ ] T4 将精确能力、未支持入口、结果待确认／暂停等待／下载重试等状态接入画布与错误详情 — 验证：不能选未实现协议；重试按钮遵守 engine 状态与幂等规则，旧失败不会自动创建新任务。
- [ ] T5 检查明暗主题、小窗口、键盘与中文输入，保持现有图片参数及多任务行为 — 验证：两种主题截图与交互记录，模型切换、单张失败重试和版本回写无回归。

## 验证

预期运行 `pnpm --filter @frame-loom/desktop test`、`pnpm --filter @frame-loom/canvas test`、`pnpm run typecheck`、相关 `pnpm --filter @frame-loom/desktop test:e2e` 和 `pnpm run verify`。Electron e2e 使用严格模拟供应商；人工检查两种主题与用户可见提示。尚未执行。

## 进度

- 2026-10-27：完成计划编制，未修改设置页或画布。

## 发现与偏差

模型服务当前测试偏文本协议，本子计划需要与 03 的状态契约同步，不能仅改标签制造媒体已检测的印象。

## 交接

等待 01～03 与实施授权。完成后向 05 提供配置／状态交互证据及未覆盖场景。
