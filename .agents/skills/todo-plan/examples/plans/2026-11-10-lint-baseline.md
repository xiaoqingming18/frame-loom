# Plan: 示例：建立代码检查基线

Status: done
Note: ../notes/implemented/process/2026-11-10-lint-baseline.md

> 虚构示例：演示已完成的单文件计划。笔记已同批移入 implemented/，Note 路径已更新。

## 目标

满足[代码检查笔记](../notes/implemented/process/2026-11-10-lint-baseline.md)：`npm run lint` 在本地与 CI 检查全部源码。

## 范围与非目标

- 范围：ESLint 依赖与配置、`lint` 脚本、CI 步骤。
- 非目标：格式化工具、存量代码的大规模修复。

## 前置条件

- 无。

## 步骤

- [x] T1 安装锁定版本的 ESLint，新增 `eslint.config.mjs` — 验证：`npx eslint --version` 输出锁定版本
- [x] T2 新增 `npm run lint` 并修复现有报错 — 验证：`npm run lint` 退出码 0
- [x] T3 CI 增加 lint 步骤 — 验证：推送后工作流通过

## 验证

- 预期：本地与 CI 的 `npm run lint` 均通过。
- 实际（示意）：2026-11-11 本地 `npm run lint` 退出码 0；CI 运行通过。

## 进度

- 2026-11-10：完成 T1、T2。
- 2026-11-11：完成 T3，笔记转 implemented，计划转 done。

## 发现与偏差

无。

## 交接

无。
