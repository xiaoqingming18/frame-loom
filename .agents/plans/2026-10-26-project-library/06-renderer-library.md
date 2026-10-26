# Plan: 项目库与详情页界面

Status: done
Parent: plan.md

## 目标

renderer 新增 `apps/desktop/src/renderer/src/features/projects/`，对齐 `docs/design/project-library-light.html` 的项目库部分，颜色只用 token：

- 路由 `routes/projects.tsx`（项目库）、`routes/projects_.$projectId.tsx`（详情，search `tab=pages|assets`、`path`），由 zod 校验，非法值回退默认。
- 项目库：标题区、新建与打开已有按钮、搜索、排序 DropdownMenu（偏好持久化）、卡片宫格、卡片菜单（重命名、在资源管理器中显示、清理未使用媒体、删除）、不可用卡片（重新定位、从项目库移除）。
- 对话框：新建本地项目（名称、保存位置条与更改、说明条、胶囊按钮、字段级错误）、打开已有项目（作为副本、重名改名）、重命名、删除（单选去向、未结束任务提示与放弃复选框）、清理未使用媒体（统计后确认）。
- 详情页：面包屑、`line` Tabs 与 Info Tooltip、新建创作页按钮、创作页卡片宫格（封面或纯色、重命名与删除菜单）、空状态。资产 Tab 内容由 07 实现，本子计划只放占位容器。
- 侧栏「项目」分组：启用「+」、列出全部项目（按项目库排序）、展开显示全部创作页或「无创作页」、高亮当前项、独立滚动。
- `theme.css` 新增成对 token `--project-paper`、`--project-paper-icon`；设计稿入库说明写进 `docs/design/README.md`。

## 前置条件

- 05 完成（目录选择、回收站、偏好桥接）。
- 需要的 shadcn 组件（如 RadioGroup、Label）按 `docs/ui-guidelines.md` 在 `packages/ui` 生成并检查 `cn` 导入与颜色。

## 步骤

- [x] T1 路由、search 校验、Query 选项与 engine 调用 — 验证：路由单测覆盖非法 `tab` 回退
- [x] T2 项目库页面、搜索、排序与卡片 — 验证：组件测试覆盖三种排序（数字感知）、搜索过滤、不可用卡片菜单项
- [x] T3 新建、打开、重命名、删除、清理对话框 — 验证：组件测试覆盖名称校验禁用、engine 错误显示在字段下、删除默认移到回收站、任务提示出现
- [x] T4 详情页与创作页 Tab — 验证：组件测试覆盖新建后跳转创作页路由、封面与纯色卡片、Tab 键盘导航
- [x] T5 侧栏项目树与新增 token — 验证：组件测试覆盖展开显示页面、「无创作页」、当前项高亮；`pnpm lint` 无颜色违规
- [x] T6 明暗截图自查 — 验证：未打包 Electron 明暗与 720×560 截图存入 `.cache/project-library/` 并逐图核对

## 验证

- 预期：`pnpm --filter @frame-loom/desktop test`、`pnpm typecheck`、`pnpm lint` 通过。
- 实际：desktop 166 项单测、全仓 628 项测试、`pnpm typecheck`、`pnpm lint`、`pnpm build` 通过。
- `apps/desktop/src/renderer/src/app/projects.test.tsx` 的 10 项测试覆盖排序、搜索、偏好、新建校验、engine 字段错误、副本打开、删除任务提示及放弃、回收站失败不移除记录、不可用移除、清理统计及会话避让、search 回退、空树、页面跳转、封面与纯色卡片、树高亮和键盘 Tabs。
- `pnpm --filter @frame-loom/desktop test:e2e -- project-library.test.ts smoke.test.ts` 共 5 项通过；实际创建／重命名项目、创建页面、重启保留和 Windows 回收站已验证，明暗模式、最小窗口、键盘 Tabs 与弹窗 Esc 关闭通过。截图位于 `.cache/project-library/` 的 `library-{light,dark}-{720,1120}.png`、`detail-{light,dark}-720.png` 和 `create-{light,dark}-720.png`。

## 进度

- 2026-10-26：创建子计划草稿。
- 2026-10-26：完成 T1–T6，复用现有 Dialog、DropdownMenu、Tabs、Tooltip、Input、Button；原生 label、radio 和 checkbox 满足表单需求，未增加依赖或生成无调用方的 UI 组件。

## 发现与偏差

- TanStack 文件路由使用尾部 `_` 让项目库、详情和创作页平级挂载在外壳下，避免详情覆盖页面入口；构建自动更新 `routeTree.gen.ts`。
- 正式创作页入口为 `routes/projects_.$projectId_.pages.$pageId.tsx`，当前明确显示项目画布待接入。实际 CanvasHost、保存与会话由 08 完成；项目资产 Tab 内容由 07 完成。未提前复用旧 `lab` 文档，未删除画布测试页。
- Playwright 默认覆盖媒体主题；e2e 清除 `colorScheme` 仿真后使用真实 `nativeTheme` 切换，截图等待弹窗可见并结束动画，避免截图捕获中间态。
- 加固 exe 的 Portal、CSP 和全流程验收仍属于 09，本轮未执行。

## 交接

无。
