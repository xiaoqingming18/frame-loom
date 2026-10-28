# Agent Note: 项目资产上传队列生命周期与拖放反馈

Status: implemented

## Problem

用户反馈点击「上传文件」选图后没有队列或请求，拖放图片时显示禁用光标。项目入口启用 React StrictMode，但原有项目界面测试没有启用。`ProjectAssets` 用 `useMemo` 保留上传队列，Effect 只返回 `dispose()` 清理；开发环境 StrictMode 执行 setup → cleanup → setup 后，同一个队列永久处于 disposed 状态，`add()` 直接返回。这解释了选择文件后完全无反应；仅修正拖放光标不能恢复上传。

此外，资产区的 `dragover` 没有明确设置复制反馈。已有 e2e 直接给 input 设置文件，缺少点击按钮触发文件选择事件及普通文件拖放的覆盖。上述问题归属[项目库方案](../feature/2026-10-26-project-library.md)，未改变原上传协议或存储决定。

## Decision

上传队列提供 `start()` 恢复接收任务；组件 Effect 在 setup 调用 `start()`，在 cleanup 调用 `dispose()`。保留队列的取消、最多两个并发和卸载后拒绝新文件的语义，不移除 StrictMode。项目界面测试使用与入口一致的 StrictMode，覆盖选文件与拖放后确实启动请求及按钮上传完成。

资产区检测文件拖入后取消默认行为，并设置 `dataTransfer.dropEffect = 'copy'`，与画布既有处理一致；文件夹仍跳过并提示。按钮和拖放复用既有队列和二进制请求。

Electron e2e 点击按钮并等待 Playwright `filechooser` 事件，再设置真实 PNG 文件；普通文件拖放使用 Chromium `DataTransfer` 和合成事件，检查列表、完成状态及落盘字节。复制效果由组件测试断言；合成事件不能证明 Windows 资源管理器的真实光标，也不声称自动操作了系统选择器窗口。

## Verification

- 修复生命周期前，启用 StrictMode 的两个新增交互测试均失败：普通文件没有发起上传，按钮选图后没有上传队列。修复后通过。
- 项目界面与队列测试验证 StrictMode 下接收文件、上传完成、清理后恢复和最终销毁停止接收，并保留并发、取消与重试覆盖。
- Electron 资产 e2e 通过按钮文件选择事件、重复上传自动改名、合成普通图片拖放、字节一致、目录移动／搜索／预览、画布互转、回收站以及明暗／最小窗口流程。
- 桌面完整单测 21 个文件、192 项通过；desktop typecheck、修改文件的 ESLint 与 Prettier、`pnpm run verify` 及 `git diff --check` 通过。桌面构建成功；本轮未执行全仓测试或重新打包。
- 测试宿主继承 `ELECTRON_RUN_AS_NODE=1` 时 Electron 会拒绝 `--remote-debugging-port=0`；运行 e2e 时仅在测试命令进程清除此环境变量，不改应用启动配置。

## Alternatives considered

- **只设置 `dropEffect = 'copy'`**：改动小并表达复制意图，但 StrictMode 回归仍然失败，不能解释或解决选图后完全无响应，因此同时修正队列生命周期。
- **关闭 StrictMode**：可以避免开发环境的清理重放，但掩盖资源管理缺陷；保留 StrictMode，以成对的启动和清理处理队列。
- **修改后端上传协议或增加 IPC 复制**：能够另建上传通道，但请求尚未发出时无法解决根因，还会扩大权限与维护范围；现有二进制上传继续使用。

## Consequences

- 收益：Effect 重放后队列恢复接收文件，按钮和拖放共用修复；回归测试不再遗漏实际入口的 StrictMode 环境。
- 代价：队列多一个与 cleanup 对应的启动入口，调用方需成对管理生命周期；真实操作系统拖拽仍需人工验收。
- 边界：不修改已有用户资产、不关闭安全校验，也不生成新安装包。当前桌面构建已更新，但旧安装包需重新打包才包含修复。
