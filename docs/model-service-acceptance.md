# 模型服务整体验收记录

验收日期：2026-10-27。基线提交：`c08cc55`，另加本轮扩展测试及文档改动。环境：Windows 11 x64、Node.js 24.22.0、pnpm 12.15.0、Electron 45.0.0。对应[子计划 08](../.agents/plans/2026-10-27-model-service-experience-and-evolution/08-acceptance.md)与[决策笔记](../.agents/notes/proposed/architecture/2026-10-27-model-service-experience-and-evolution.md)。

结论：本地自动回归通过，新增三类模型可以通过定义、接入和绑定运行现有协议；整体重构尚未通过全部验收。用户明确本轮不进行真实收费联调。以下能力表描述仓库实现，不能作为供应商支持承诺。

## 七型号与协议矩阵

定义／能力／适配器契约均为 `v1`。渠道绑定使用用户填写的精确上游 ID；仓库没有经过真实验证的渠道绑定。内置定义的 `evidence` 当前为空，下面列出笔记保留的来源，尚未重新联网核对其时效、区域、账号权限及所有字段。

| 逻辑定义 | 内置上游 ID | 协议 | 仓库开放模式 | 声音与主要限制 | 来源及证据缺口 |
| --- | --- | --- | --- | --- | --- |
| seedance-2.5 | doubao-seedance-2-5-260628 | ark-video-tasks | 文生、首帧、首尾帧、多模态参考 | 可开关；4～15 秒；480p/720p/1080p | [官方教程](https://docs.volcengine.com/docs/ark/seedance-2-5?lang=zh)；笔记记载首尾帧需 adaptive，当前 profile 未强制该组合条件 |
| seedance-2.0 | doubao-seedance-2-0-260128 | ark-video-tasks | 文生、首帧、首尾帧、多模态参考 | 可开关；4～15 秒；480p/720p | 同上；精确型号、组合及账号能力待联调 |
| seedance-2.0-fast | doubao-seedance-2-0-fast-260128 | ark-video-tasks | 文生、首帧、首尾帧、多模态参考 | 可开关；4～15 秒；480p/720p | 同上；不能从普通 2.0 外推 Fast |
| kling-4.0 | kling-v4（另有精确别名 klingai-v4） | kling-video | 文生、首帧 | 禁止尾帧；5/10 秒；16:9、9:16、1:1；sound 可开关 | [4.0 文生](https://klingai.com/document-api/api/video/4-0/text-to-video.md)、[鉴权](https://kling.ai/document-api/api/get-started/authentication.md)；现有适配器为旧式扁平 body／text2video 路径，与笔记描述的新版型号路径、嵌套 settings/options 未对齐 |
| kling-3.0 | kling-v3（另有精确别名 klingai-v3） | kling-video | 文生、首帧 | 与 4.0 使用相同仓库限制，不能证明官方能力相同 | [3.0 图生](https://klingai.com/document-api/api/video/3-0-omni/image-to-video.md)；当前默认提交路径不按图生切换，参考模式未开放；需精确协议修正及真实验证 |
| wan-3.0 | wan3.0-video、wan-3.0 | wan-video | 文生、首帧、首尾帧 | audio 可开关；2～10 秒；1280*720、720*1280、960*960；图片为 URL 交付 | [API 参考](https://docs.modelstudio.console.alibabacloud.com/en/model-studio/wan3-video-generation-api-reference)；目前 body 使用 input.first_frame_url/last_frame_url，响应解析 data.task_id；笔记的新协议描述包含 input/media/parameters 和异步头，需对齐，不能宣称原生完整支持 |
| minimax-h3 | MiniMax-H3 | minimax-video-v2 | 文生、首帧、首尾帧、多模态参考 | 4～15 秒；768P/2K；文生禁止 adaptive；profile 未声明有声输出 | [创建](https://platform.minimax.io/docs/api-reference/video-generation-v2-create)、[查询](https://platform.minimax.io/docs/api-reference/video-generation-v2-query.md)；默认路径保留 minimax/v2 挂载前缀，不能直接当官方地址使用；有声交付证据待补 |

Seedance/MiniMax 的仓库参考上限为图片 9、视频 3、音频 3；单个视频／音频 2～15 秒且同类型总时长不超过 15 秒。素材类型、尺寸、编码和帧率仍由共享校验约束，不等于每个供应商接受全部组合。

协议请求由 `adapters/video-tasks.test.ts` 精确断言，七个 profile 的角色与模式边界由 `profiles/video-capabilities.test.ts` 覆盖；同一协议的 Mock 成功不覆盖所有型号与模式的真实可用性。

| 兼容绑定路径 | 当前实际边界 | 验证级别 |
| --- | --- | --- |
| 同渠道多接入、不同域名／前缀 | 接入显式地址和相对路由，模型只引用接入；同一凭据账号共享配额 | 目录、生成、恢复集成测试 |
| Seedance 三型号、Wan 3.0、MiniMax H3 的旧 JSON 计费别名 | `video-retirement.ts` 仅保留精确映射，原协议标识 fastaitoken-video；不内置站点地址 | 历史模拟与本轮恢复回归；没有真实站点绑定验收 |
| 同逻辑型号换协议 | 当前定义固定 protocol，只能另建定义与匹配接入，不能直接把原定义绑定到另一协议 | 跨协议不匹配拒绝；七型号的多协议等价定义矩阵尚未补齐 |
| OpenAI multipart 视频兼容 | 执行器保留，Sora 等旧配置已退出；不能通过导入恢复已退出型号 | 仅兼容恢复／内容下载模拟，不是新增首批型号支持证明 |
| 编辑、延长、多镜头、文档／网页参考、复杂签名 | 未开放；需要正式适配实现及完整输入输出契约 | 共享模式校验拒绝，业务 UI 不展示空操作 |

## 四模态与演进证据

| 范围 | 本轮可复核证据 | 边界 |
| --- | --- | --- |
| 文本 | 既有 llm 测试回归四协议、流式及错误；设置 E2E 验证保存／默认模型 | 不把媒体任务内核套在文本流上；没有供应商实测 |
| 图片 | 图片请求夹具、参考／语义参数及画布多结果回归；扩展测试导入 future-image 后实际 HTTP 生成并归档 PNG | 新操作仍需执行器支持 |
| 视频 | 扩展测试导入 future-video，复用 Ark 提交／查询／下载并归档 MP4 | 新增定义只是受支持协议的模拟型号，不代表未来型号线上支持 |
| TTS | 扩展测试导入 future-tts，复用 OpenAI 二进制语音；既有 MiniMax hex、音色隔离、试听与元数据测试 | 目录失败可手填；文件探测决定实际格式、时长、采样率、声道，响应声明不替代文件 |
| 导入 | 预览不落库／不联网；确认冲突、失效预览拒绝、整批回滚、跨账号及敏感字段拒绝 | 目前只接收 bearer v1；自定义 mappings 全部明确拒绝执行，尚未实现原方案有限声明式字段映射 |
| 版本更新 | 三类新定义同标识更新需确认；更新提交路由及能力只影响新任务，旧任务冻结快照保持原值；重启后旧结果相同 | 只接受 definitionVersion/capabilityVersion/connection.version v1；v2 被拒绝，不能宣称支持任意版本并存升级 |

新增测试位于 `apps/engine/src/modules/generation/model-evolution.integration.test.ts`，全部走真实本地 HTTP、SQLite、生成服务和媒体探测。每个模态仅允许两次 POST，精确校验原／新地址、模型 ID、关键请求字段、JSON 编码和凭据；视频结果下载不携带密钥。扩展不修改 renderer、canvas 或生产型号分支。

ASR 缺转写操作及文本／分段归档和隐私规则；音乐／音效缺协议、版权／时长参数和业务入口；克隆缺所有者授权、训练与远端删除生命周期。三项沿用 06 的逐项顺延结论，本轮未新增空入口，不把音色 ID 管理称为克隆。

## 故障、历史与升级

- `generation.integration.test.ts`：未知提交、503、明确 429、重启、共享凭据配额、取消迟到响应、远端取消未知回执、部分下载及过期产物刷新；通过提交计数限制非幂等重投。
- `recovery.integration.test.ts`：上传复用、上传未知、同键同体恢复、凭据变化暂停、下载重试与脱敏。
- `model-upgrade.integration.test.ts`、数据库测试与 `e2e/model-upgrade.test.ts`：临时旧库迁移、备份、失败回滚、默认清理、在途旧任务恢复及共用凭据保护；用户真实库未操作。
- 旧协议／旧快照兼容层的退出条件：所有引用它的在途任务完成或用户显式本地放弃后清理绑定；历史记录与文件继续保留。不能按日期删除恢复代码或重投缺少快照的任务。

## 本轮命令与桌面产物

| 命令 | 实际结果 |
| --- | --- |
| pnpm run test | 697 项通过：contracts 189、canvas 106、desktop 177、engine 225 |
| pnpm run typecheck | 通过 |
| pnpm run lint | 通过 |
| pnpm run build | 通过 |
| pnpm --filter @frame-loom/desktop test:e2e | 最终完整 18 项通过；首轮与 package:prepare 重建重叠导致启动失败，完成构建后完整重跑通过，今后串行执行 |
| pnpm --filter @frame-loom/desktop package:dir | 通过，生成加固 Windows x64 目录版 |
| pnpm run package:win | 通过，生成 Windows x64 NSIS，未签名 |
| pnpm run format:check、pnpm run verify、git diff --check | 通过；verify 检查 23 篇笔记和 59 份计划 |

日志存于忽略目录 `.cache/model-acceptance/`；界面截图在 `apps/desktop/test-results/`。E2E 覆盖 800×800 明暗窗口、模型帮助悬浮／聚焦／点击与 Esc、收费确认、草稿禁用、画布模式及切换保护、图片回归、TTS 音色／实际播放／元数据和重启。本轮实际查看 TTS 明暗及画布视频暗色帮助截图：控件、确认按钮及帮助可见；视频输入框按既定规范可超出视口，不另做响应式收窄。

加固目录版使用独立 `.cache/model-acceptance/native-profile` 启动，未修改用户配置。通过 Computer Use 实际观察明亮首页、模型服务表单、接口地址帮助 Portal；随后用户以物理 Esc 停止 Computer Use，停止原生操作。原生暗色、真实中文输入法组合输入、加固版音视频播放仍未验证；自动 E2E 的文本填充与开发 Electron 播放不能替代这些项目。NSIS 只完成构建，未安装／升级用户环境；实际旧用户库副本升级与安装包升级仍待后续验收。

产物 SHA-256（本地构建，非签名发布）：

- `apps/desktop/release/Frame Loom Setup 0.1.0.exe`：`60357A6B8BE81AD49651F288FF9D5DF0B238AF34F8B5C3C659CB271EB5FD6927`。
- `apps/desktop/release/win-unpacked/Frame Loom.exe`：`E6E91105D6460467388CAD0E5386ACB4527F78AB68EBCD0B6CAC3B8C6E9A480D`。
- 构建保留 runAsNode／NODE_OPTIONS／CLI inspect 禁用、只从 asar 加载和嵌入完整性校验，未放宽 fuses 或 CSP。

## 剩余验收与下一步

1. 按来源重新核对七型号的精确请求／响应、模式、声音、素材和账号权限，先修正 Kling/Wan 协议及其他不一致，再按精确绑定补充可执行夹具；不从旧协议 Mock 推导官方支持。
2. 补齐受限映射执行及对应失败边界，或由用户单独决定调整范围；目前保留明确拒绝。目录版本 v2／多版本并存与同型号多协议也须明确实现边界。
3. 完成原生暗色、最小窗口、输入法组合输入、加固版媒体播放、实际用户库副本和 NSIS 安装／升级验证。
4. 本轮用户选择不做真实收费联调。后续需渠道名、精确型号／模式、合法素材和费用上限，再记录脱敏任务 ID、提交／查询／上传／归档及未测项；保存配置或目录检查不算真实生成成功。
5. 在上述必交付和验证齐备前，父计划和决策笔记保持未完成，不迁入 implemented，不发布线上可用声明。
