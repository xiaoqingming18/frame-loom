# Plan: 项目库与详情页界面

Status: draft
Parent: plan.md

## 目标

renderer 新增 `apps/desktop/src/renderer/src/features/projects/`，对齐 `docs/design/project-library-light.html` 的项目库部分，颜色只用 token：

- 路由 `routes/projects.tsx`（项目库）、`routes/projects.$projectId.tsx`（详情，search `tab=pages|assets`、`path`），由 zod 校验，非法值回退默认。
- 项目库：标题区、新建与打开已有按钮、搜索、排序 DropdownMenu（偏好持久化）、卡片宫格、卡片菜单（重命名、在资源管理器中显示、清理未使用媒体、删除）、不可用卡片（重新定位、从项目库移除）。
- 对话框：新建本地项目（名称、保存位置条与更改、说明条、胶囊按钮、字段级错误）、打开已有项目（作为副本、重名改名）、重命名、删除（单选去向、未结束任务提示与放弃复选框）、清理未使用媒体（统计后确认）。
- 详情页：面包屑、`line` Tabs 与 Info Tooltip、新建创作页按钮、创作页卡片宫格（封面或纯色、重命名与删除菜单）、空状态。资产 Tab 内容由 07 实现，本子计划只放占位容器。
- 侧栏「项目」分组：启用「+」、列出全部项目（按项目库排序）、展开显示全部创作页或「无创作页」、高亮当前项、独立滚动。
- `theme.css` 新增成对 token `--project-paper`、`--project-paper-icon`；设计稿入库说明写进 `docs/design/README.md`。

## 前置条件

- 05 完成（目录选择、回收站、偏好桥接）。
- 需要的 shadcn 组件（如 RadioGroup、Label）按 `docs/ui-guidelines.md` 在 `packages/ui` 生成并检查 `cn` 导入与颜色。

## 步骤

- [ ] T1 路由、search 校验、Query 选项与 engine 调用 — 验证：路由单测覆盖非法 `tab` 回退
- [ ] T2 项目库页面、搜索、排序与卡片 — 验证：组件测试覆盖三种排序（数字感知）、搜索过滤、不可用卡片菜单项
- [ ] T3 新建、打开、重命名、删除、清理对话框 — 验证：组件测试覆盖名称校验禁用、engine 错误显示在字段下、删除默认移到回收站、任务提示出现
- [ ] T4 详情页与创作页 Tab — 验证：组件测试覆盖新建后跳转画布路由、封面与纯色卡片、Tab 键盘导航
- [ ] T5 侧栏项目树与新增 token — 验证：组件测试覆盖展开显示页面、「无创作页」、当前项高亮；`pnpm lint` 无颜色违规
- [ ] T6 明暗截图自查 — 验证：开发版明暗与 720×560 截图存入 `.cache/project-library/`

## 验证

- 预期：`pnpm --filter @frame-loom/desktop test`、`pnpm typecheck`、`pnpm lint` 通过。
- 实际：未执行。

## 进度

- 2026-10-26：创建子计划草稿。

## 发现与偏差

无。

## 交接

尚未开始；等待 05。
