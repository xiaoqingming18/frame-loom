# Agent Note: 示例：建立 Electron 应用骨架

Status: proposed

> 虚构示例，配合 todo-plan 计划示例演示链接关系，不代表项目决定。

## Problem

示意：仓库没有可启动的 Electron 应用，主进程、预加载与渲染进程的边界未定义。

## Proposal

示意：主进程、预加载、渲染进程分包，渲染进程只通过预加载暴露的类型化接口调用主进程。

## Alternatives considered

示意：开启 `nodeIntegration` 直接在渲染进程调用 Node API，入门成本最低；但扩大攻击面，不采用。

## Acceptance criteria

示意：开发模式可启动窗口；渲染进程通过类型化 IPC 读取应用版本；打包产物可在 Windows 启动。

## Risks

示意：IPC 契约早期变化频繁。
