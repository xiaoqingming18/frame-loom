# Plan: 模型定义、服务接入与导入契约

Status: done
Parent: plan.md

## 目标

在共享契约中表达渠道、服务接入、模型定义和渠道绑定，提供可版本化有效能力与有限映射，供 engine 与 renderer 共用。

## 前置条件

- 用户已授权开始实现，本计划与父计划已转 active。
- 阅读关联笔记及 `packages/contracts/src/models.ts`、`generation.ts`、`service-routing.ts`、`image-params.ts`、`image-references.ts`；核对渠道、生成任务及画布的全部调用者。
- 使用父计划指定工具链；实现与契约测试结果记录在“验证”。

## 步骤

- [x] T1 定义分层对象、稳定逻辑 ID、精确版本、渠道别名和凭据引用；划定现有字段兼容边界 — 验证：`model-catalog.test.ts` 覆盖同模型不同协议、同渠道多接入、跨渠道绑定和明文凭据拒绝。
- [x] T2 从现有 ModelProfile 拆分模型能力、接入能力及运行策略，建立模式、参数、素材、声音与组合条件的共享解析／校验 — 验证：`effectiveCapabilities` 以声明能力与适配器能力求交，禁止能力越界。
- [x] T3 定义有限映射的字段选择、嵌套、固定值、类型／枚举转换、素材角色和内置编码；设置深度、大小及数量上限 — 验证：`validateMapping` 拒绝脚本、表达式、越界路径、无限结构和未知转换。
- [x] T4 定义导入包 schema／依赖版本、来源、冲突、预览差异、事务提交及验证状态；保留升级与历史解释规则 — 验证：导入包 schema 拒绝敏感字段、未知必需版本、非法网络目标和能力膨胀字段。
- [x] T5 定义七型号目录与可扩展操作标识、参数帮助元数据、规范化请求／产物以及音色归属；特殊视频操作仅可声明未执行状态 — 验证：目录使用可扩展字符串 ID，未实现操作不注册为可执行适配器。

## 验证

预期运行 `pnpm --filter @frame-loom/contracts test`、`pnpm run typecheck`、`pnpm run verify`，必要时在读取实际脚本后缩小到相关文件。断言关注组合、版本和信任边界，不添加镜像实现测试。

实际：`pnpm --filter @frame-loom/contracts test` 通过（188 tests）；`pnpm --filter @frame-loom/contracts typecheck`、`pnpm run typecheck`、`pnpm run format:check`、`pnpm run verify` 均通过。

## 进度

- 2026-10-27：用户授权施工，计划转 active 并完成本子计划。
- 2026-10-27：完成 `model-catalog.ts` 及契约测试，导出分层连接／模型／绑定／映射／导入对象和有效能力计算；保留旧契约兼容。

## 发现与偏差

现有参数值主要为标量，不能通过任意 JSON 透传绕开新操作的专属输入校验。四种职责不要求机械增加四张表，落库方式在读懂现有 schema 后选最小完整方案。

## 交接

无。契约可供后续 03～08 使用；尚未接入数据库迁移或桌面导入流程。
