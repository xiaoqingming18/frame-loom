# Plan: 验收与收尾

Status: draft
Parent: plan.md

## 目标

- 新增桌面 e2e：新建项目与创作页、画布上传图片、重启后项目／页面／内容／视口保留；侧栏展开进入页面；资产上传、新建文件夹、移动、搜索、切换布局；从资产添加到画布与保存到资产；删除项目移到回收站（临时目录，检查目录消失）。
- 开发版与加固 exe 的明暗人工验收，覆盖笔记验收标准中的四项人工检查。
- 笔记转 `implemented/feature/`，相关笔记原地同步，计划转 `done`。

## 前置条件

- 08 完成。

## 步骤

- [ ] T1 编写新增 e2e 用例 — 验证：`pnpm --filter @frame-loom/desktop test:e2e` 全部通过
- [ ] T2 开发版与加固 win-unpacked exe 明暗人工验收，720×560 与键盘操作，外部改名／删除资产与 U 盘拔出场景，拷贝项目后打开 — 验证：截图与记录存入 `.cache/project-library/acceptance.md`，加固 exe 无 CSP 违规
- [ ] T3 全仓门禁 — 验证：`pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm format:check`、`pnpm run verify` 通过
- [ ] T4 笔记转 implemented，同步无限画布、主题与外壳、模型管理、桌面壳、应用骨架、共享契约、engine 服务笔记，以及 `docs/ui-guidelines.md`、`AGENTS.md` 的现状描述 — 验证：`pnpm run verify` 通过，计划 `Note:` 指向 implemented
- [ ] T5 父计划与全部子计划转 `done` — 验证：`pnpm run verify-plans` 通过

## 验证

- 预期：上述命令全部通过，人工验收记录完整。
- 实际：未执行。

## 进度

- 2026-10-26：创建子计划草稿。

## 发现与偏差

无。

## 交接

尚未开始；等待 08。
