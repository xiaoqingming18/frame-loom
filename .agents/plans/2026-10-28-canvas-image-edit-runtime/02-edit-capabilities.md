# Plan: 图片编辑有效能力与旧目录兼容

Status: done
Parent: plan.md

## 目标

使多角度、重打光和表情按不同执行要求判定；已知内置档案的历史字段缺失可受控升级，同时保留明确禁用、自定义能力收窄和历史任务快照。

## 前置条件

- 2026-10-28 用户已通过 /goal 授权实施。
- 阅读 `packages/contracts/src/image-edit.ts`、`generation.ts`、`model-catalog.ts`，`apps/engine/src/modules/generation/profiles/image-profiles.ts`、`media-profiles.ts`、`generation.service.ts`，以及 `apps/engine/src/modules/channels/model-catalog.service.ts`、`channels.repository.ts`、desktop `project-canvas.tsx` 和相关模型目录集成测试。
- 开始实施先只读检查用户实际选定模型的 `/channel-models` 脱敏 `effectiveProfile`，与 `/model-profiles` 对照。不能据错误文案直接把本机旧目录认定为此次现场根因；不得导出凭据、请求头或私有敏感地址。
- 目录升级须遵循既有事务／备份规则，不删除 `model_bindings_v1` 标记，不重建或清空用户数据库。

## 步骤

- [x] T1 将图片编辑能力拆为提示词／参考图语义操作与表情专属协议、参考数、蒙版约束 — 验证：contracts 参数化测试覆盖 angle／lighting／emotion 与缺能力、明确禁用、参考上限、OpenAI Images、mask true/false 的独立结果。
- [x] T2 定义只对已知内置图片定义补齐历史缺字段的版本化／受控目录升级 — 验证：临时旧目录夹具带初始化 marker 且缺字段时可升级；重复升级结果稳定；用户自定义 profile、显式禁用及比内置更窄的参考／mask 限制保留。
- [x] T3 保证 channels 返回的 effectiveProfile 经统一能力解析后同时用于画布和新任务验证 — 验证：engine 集成测试断言响应字段、画布测试与 `/generation-jobs` 对同一档案得到相同放行／拒绝及专属错误原因。
- [x] T4 保持历史任务冻结快照且目录升级不影响其恢复解释 — 验证：使用一项现有任务快照回归断言仅新任务消费升级后的能力，旧快照 profile、request、恢复目标不被重写。

## 验证

### 必须执行

- 新增的 contracts 纯函数定向测试。
- 一组 engine 临时模型目录升级集成测试，覆盖 marker 已存在、幂等、显式收窄保留。
- 一项有效档案到画布／提交侧的一致性测试；一项历史快照不变回归。
- 测试用数据库必须临时创建并销毁，不连接或修改用户真实目录。失败时读取相关测试日志片段，不重复跑无关恢复矩阵。

### 省略与扩测条件

- 不遍历所有供应商型号／别名组合，不模拟真实收费调用，不重做普通 image params、素材上传、像素合成和多任务测试。
- 若模型目录 schema 需要迁移、覆盖规则可能丢失配置或无法区分用户收窄与内置历史字段，先暂停评审具体数据转换；不得默认全局补开三种操作。
- 用户现场 profile 核验若不能取得，只能报告代码路径／测试夹具结论，不能记录为其模型档案问题已复现。

实际：
- `pnpm --filter @frame-loom/contracts exec vitest run src/image-edit.test.ts`：5/5 通过，覆盖三协议、未知／禁用、参考模式、额度及蒙版。
- 原模型目录集成测试通过；新增 `image-edit-upgrade.integration.test.ts` 首次发现 JSON 序列化去掉 undefined 字段的匹配差异，修复后定向复跑 1/1 通过。夹具已有 model_bindings_v1，验证一次备份、独立升级标记、事务、幂等、限制保留和历史任务整行不变。
- `pnpm --filter @frame-loom/canvas exec vitest run src/nodes/image-edit-tools.test.tsx`：6/6 通过，新增 Gemini／Ark 可选用角度且表情协议拒绝的代表用例。
- HTTP channel-models 返回升级能力；同一禁用档案的共享规则与 generation-jobs 422 文案一致；03 补充旧目录真实重启 → UI 选择 → 模拟提交验收。
- 用户现场有效档案未取得，只确认代码和临时目录路径。

## 进度

- 2026-10-28：编写子计划；前次只读诊断确认目录字段可缺失且执行层不补齐，未实施修复。

- 2026-10-28：完成共享校验、内置声明、安全补齐与快照回归，交付 03。

## 发现与偏差

`imageEditCapabilities` 是可选 profile 字段；初始化 marker 已存在会跳过内置合并，且持久目录包优先。Gemini／Ark 内置档案现声明角度和打光。它们是需分别处理的历史兼容和能力数据缺口，不证明同名模型的实际接入能力必然相同。

无来源元数据时，只有除缺失能力外全部字段匹配的内置旧定义自动补齐。名称、约束、输入额度等已修改的同 id 定义与 migrated 自定义定义仍走显式更新，保留提案要求的保守边界；无 schema 变更。测试只移除新升级标记构造夹具，未删除 model_bindings_v1 或操作真实用户库。

## 交接

无。
