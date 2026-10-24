# Plan: 示例：建立 Electron 应用骨架

Status: active
Note: ../../notes/proposed/architecture/2026-11-02-electron-app-skeleton.md

> 虚构示例：演示父计划写法，展示 done / active / draft 三种子计划状态并存的中间时刻。

## 目标

满足[骨架笔记](../../notes/proposed/architecture/2026-11-02-electron-app-skeleton.md)的验收标准：开发模式可启动窗口，渲染进程通过类型化 IPC 读取应用版本，Windows 打包产物可启动。

## 范围与非目标

- 范围：主进程、预加载、渲染进程三个入口，开发与打包脚本，最小 IPC 契约。
- 非目标：业务界面、模型接入、媒体处理、自动更新。

## 子计划

| 编号 | 子计划 | 状态 | 依赖 | 交付物 |
| --- | --- | --- | --- | --- |
| 01 | [主进程与预加载](01-main-preload.md) | done | — | `npm run dev` 打开空窗口 |
| 02 | [渲染进程与 IPC 契约](02-renderer-ipc.md) | active | 01 | 界面显示主进程返回的版本号 |
| 03 | [Windows 打包](03-windows-package.md) | draft | 01、02 | 可启动的安装包 |

## 依赖与顺序

- 关键路径：01 → 02 → 03。
- 可并行：03 的打包配置调研可与 02 并行，正式验证需等 02 完成。

## 验收

- [x] 开发模式可启动窗口 — 证据：[01 验证](01-main-preload.md#验证)
- [ ] 渲染进程通过类型化 IPC 读取版本 — 证据：02 验证
- [ ] Windows 打包产物可启动 — 证据：03 验证

## 发现与偏差

- 2026-11-04：预加载脚本需要输出 CommonJS，见 [01 发现与偏差](01-main-preload.md#发现与偏差)。只影响构建步骤，不改变骨架决定。
