# Plan: 示例：渲染进程与 IPC 契约

Status: active
Parent: plan.md

## 目标

React 界面显示主进程返回的应用版本号；IPC 通道名与参数类型只在一处定义。

## 前置条件

- 子计划 01 已完成。

## 步骤

- [x] T1 新增 `src/shared/ipc.ts`，定义 `app:get-version` 通道及返回类型 — 验证：`npm run typecheck` 通过
- [ ] T2 主进程注册处理器，预加载暴露 `frameLoom.getVersion()` — 验证：开发者工具调用返回版本字符串
- [ ] T3 React 首页调用并显示版本 — 验证：界面出现版本号

## 验证

- 预期：`npm run typecheck` 通过；`npm run dev` 后首页显示 `package.json` 中的版本。
- 实际：未执行。

## 进度

- 2026-11-05：完成 T1。

## 发现与偏差

无。

## 交接

T1 已提交。下一步从 T2 开始：在 `src/main/index.ts` 注册 `app:get-version` 处理器，处理器类型从 `src/shared/ipc.ts` 导入。工作区没有未提交改动。
