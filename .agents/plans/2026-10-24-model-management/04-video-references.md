# Plan: 视频与参考素材

Status: done
Parent: plan.md

## 目标

- 接入 `ark-video-tasks`、`minimax-video-v2`、`openai-videos` 三个视频协议。
- 参考视频和参考音频统一走 S3 兼容对象存储与预签名链接；未配置对象存储时拦截。
- 提交前用 ffprobe 预检素材。
- 新增设置页签"对象存储"，模型测试页新增视频页签，可以播放生成的视频并拖动进度。

## 前置条件

- 03 完成：任务内核、媒体落盘、`frame-media://` 可用。

## 步骤

- [x] T1 选定 `@ffprobe-installer/ffprobe@2.1.2` 平台预编译包，作为 engine 生产依赖随部署树分发；开发环境、packaged layout 与新版 NSIS 安装后的模拟视频均读取到 2 秒时长，并已同步[应用骨架](../../notes/implemented/architecture/2026-10-24-desktop-stack-and-process-model.md)笔记。
- [x] T2 选定轻量 `aws4fetch@1.0.20` 实现 SigV4；安装体积、维护状态与未选 AWS SDK 的理由见[模型管理笔记](../../notes/proposed/architecture/2026-10-24-model-management.md)。`modules/object-storage` 包含：
  - `object_storage_config`（Secret 加密保存）与 `object_uploads` 两张表；
  - 上传与预签名；
  - 四步连接测试：上传、预签名、不带凭据下载并比对、删除。

  验证：用 AWS 公布的 SigV4 测试向量做签名测试；用模拟 S3 服务测试同一素材只上传一次、每次提交的预签名链接不同
- [x] T3 参考素材管线：
  - 按能力档案选择内联或 URL；
  - 参考视频和参考音频在未配置对象存储时返回 `OBJECT_STORAGE_REQUIRED`；
  - 用 ffprobe 预检时长、帧率、分辨率、编码、大小与总时长。

  验证：集成测试覆盖未配置时拒绝、超限时拒绝、合规素材的请求体中带预签名链接
- [x] T4 三个视频适配器与内置档案，包括 Seedance 2.0 系列和 H3 系列，加通用视频档案；结果链接过期时，支持重新查询的协议先重新查询再下载 — 验证：适配器录制样例和 engine 集成测试通过，`pnpm test` 包含完整视频任务、ffprobe 元数据及对象存储覆盖。
- [x] T5 renderer 的"对象存储"设置页签：配置表单、连接测试、生命周期规则建议与隐私说明 — 验证：组件测试通过；开发验收明暗模式截图通过。
- [x] T6 模型测试页的视频页签：首帧、尾帧、参考图、参考视频、参考音频的输入；未配置对象存储或约束冲突时禁用对应输入并说明原因；产物可以播放并跳转进度 — 验证：组件测试通过；开发窗口与 packaged layout 的视频播放读到 2 秒时长并收到 `frame-media://` 206 Range 响应；明暗模式通过。

## 验证

- `pnpm test`：351 项通过；`pnpm typecheck`、`pnpm lint`、`pnpm format:check`、`pnpm run verify` 通过。
- 开发环境模拟图像/视频验收通过；视频 duration 为 2 秒，跳转进度后观察到 `frame-media://` 206 Range 响应，浅色/深色主题通过，应用正常退出。
- packaged layout 使用当前 `out/`、engine 部署树，在本机 Electron 45 runtime 下模拟验收通过；视频 duration 为 2 秒，跳转进度后观察到 `frame-media://` 206 Range 响应，明暗模式通过。
- 已生成独立目录的加固 exe 与 NSIS 安装包；NSIS 静默安装后，安装目录中的 `ffprobe.exe` 成功读取测试视频的 H.264 编码、320x256 分辨率、24 fps 与 2 秒时长。

## 进度

- 2026-10-24：创建子计划草稿。
- 2026-10-25：按用户指令实施；复用 03 任务调度、媒体协议与恢复逻辑。开发及 packaged layout 模拟验收、全仓检查通过。
- 2026-10-25：修复未配置对象存储时 GET 返回空响应体的问题，接口现在明确返回 JSON `null`；集成测试覆盖状态码、Content-Type 与响应体，7 项 generation 集成测试通过。

## 发现与偏差

打包工具默认输出目录曾受旧文件锁影响，改用独立输出目录后已完成加固 exe、NSIS 及安装后 ffprobe 验收。真实厂商接口和 TTS 仍属于 05。

## 交接

无；T1～T6 已实现并通过自动、开发窗口、packaged layout 与安装后验收。真实厂商冒烟、TTS 和整体验收归 05。
