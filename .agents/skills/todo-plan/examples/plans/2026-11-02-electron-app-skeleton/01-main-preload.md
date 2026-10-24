# Plan: 示例：主进程与预加载

Status: done
Parent: plan.md

## 目标

`npm run dev` 启动后出现空白窗口，渲染进程中 `window.require` 不可用。

## 前置条件

- Node.js 22.12.0 或更高版本，已执行 `npm ci`。

## 步骤

- [x] T1 新增 `src/main/index.ts`，创建关闭 `nodeIntegration`、开启 `contextIsolation` 的窗口 — 验证：窗口出现
- [x] T2 新增 `src/preload/index.ts`，通过 `contextBridge` 暴露空对象 `frameLoom` — 验证：开发者工具中 `window.frameLoom` 存在
- [x] T4 预加载构建输出改为 CommonJS — 验证：控制台无预加载加载错误
- [-] T3 引入热重载插件 — 放弃：开发服务器自带重载已足够，见发现与偏差

## 验证

- 预期：`npm run dev` 打开窗口；开发者工具中 `typeof window.require === 'undefined'`。
- 实际（示意）：2026-11-04 执行 `npm run dev`，窗口出现，`typeof window.require` 为 `undefined`。

## 进度

- 2026-11-03：完成 T1、T2。
- 2026-11-04：发现预加载格式问题，新增并完成 T4；放弃 T3。

## 发现与偏差

- 沙箱化预加载无法加载 ES 模块，新增 T4 改为 CommonJS 输出。仅影响构建配置，不改变笔记决定。
- 开发服务器已支持渲染进程重载，T3 收益不足，放弃。

## 交接

无。
