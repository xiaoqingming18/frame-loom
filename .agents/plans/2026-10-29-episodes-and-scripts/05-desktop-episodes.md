# Plan: 项目设定、剧集列表与侧栏

Status: draft
Parent: plan.md

## 目标

renderer 提供以下功能，规格见功能笔记「界面 → 项目库与项目设定」「项目详情」「侧栏项目树」三节：

- 项目设定表单：在新建项目对话框中可选填写，项目卡片菜单和详情页齿轮按钮可以打开编辑；
- 项目卡片显示设定摘要；
- 详情页有四个 Tab，默认显示剧集；
- 剧集列表，以及新建、编辑、删除剧集的对话框；
- 创作页对话框可以选择所属剧集；
- 侧栏项目树按剧集分组；
- 剧本页路由外壳：面包屑、加载状态、错误状态，以及 fullBleed 布局。

同时修改受导航变化影响的现有测试。本子计划不包含编辑器（06）和导入（08）。

## 前置条件

- 02 已完成，engine 接口可用。
- 已阅读以下文件：`features/projects/` 下的 `project-library.tsx`、`project-detail.tsx`、`project-dialog.tsx`、`project-tree.tsx`；`lib/project-queries.ts`；`routes/projects_.$projectId.tsx`；`app/shell/app-shell.tsx`；`app/projects.test.tsx` 中的 `mount` 写法；`e2e/project-canvas.fixture.ts`。
- 已阅读 [UI 规范](../../../docs/ui-guidelines.md)。

## 步骤

- [ ] T1 在 `lib/project-queries.ts` 中新增查询：
  - `episodesQuery`，queryKey 为 `['projects', id, 'episodes']`；
  - `scriptQuery`，queryKey 为 `['projects', id, 'episodes', episodeId, 'script']`；
  - `storyQuery`，queryKey 为 `['projects', id, 'story']`。

  所有响应都用 contracts 中的 schema 解析。

  — 验证：typecheck 通过。这些查询在 T3、T5 的组件测试中被实际调用。
- [ ] T2 新建 `features/projects/profile-fields.tsx`（`ProfileFields`）：
  - 内容形式和制作媒介用单选卡片，使用 radio 语义；
  - 题材用 chip 多选，最后一项是「+ 自定义」，点击后变成行内输入框，按回车添加，按 Esc 取消；自定义 chip 带删除按钮；超过 5 个时显示提示；
  - 画幅为单选；
  - 组件支持 `compact` 模式，此时只显示必填的内容形式、制作媒介和题材。

  修改 `project-dialog.tsx`：在新建项目对话框中加入一个默认收起的折叠区「项目设定（可选）」，底部说明文案照抄笔记。没有填写任何字段时，请求不带 `profile`。新增一个 `profile` 动作，打开「项目设定」对话框，不显示名称和保存位置，提交 `PUT /projects/:id/profile`。项目卡片菜单增加「项目设定」，详情页标题旁增加齿轮按钮「项目设定」。

  — 验证：在 `app/projects.test.tsx` 中新增用例，覆盖以下几点：
  - 不展开折叠区时，请求体不含 `profile`；
  - 填写设定后，请求体中的 `profile` 正确；
  - 选第 6 个题材时被阻止并显示提示；
  - 自定义题材可以添加和删除；
  - 卡片显示 `formatProfile` 的输出，没有设定时显示「未设置项目设定」；
  - 从卡片菜单打开设定对话框并保存，请求为 `PUT`。
- [ ] T3 修改 `routes/projects_.$projectId.tsx`：`tab` 的取值为 `episodes | pages | story | assets`，默认值和非法值都回退为 `episodes`。

  修改 `project-detail.tsx`：Tab 依次为剧集、创作页、设定库、项目资产；设定库 Tab 暂时显示「设定库即将可用」占位，由 09 替换。

  修改入口链接：`project-library.tsx`、`project-tree.tsx`，以及 `project-dialog.tsx` 新建项目成功后的跳转，都改为 `tab: 'episodes'`。`project-canvas.tsx` 的面包屑保持 `tab: 'pages'`。

  — 验证：修改 `projects.test.tsx` 中原有的「详情非法 search 回退」用例，期望 `tab` 为 `episodes`；原有用例中涉及创作页 Tab 的，先切换到「创作页」Tab。在 `mount` 的默认模拟中加入 `/projects/${id}/episodes`，返回 `[]`。
- [ ] T4 新建 `features/projects/episodes/`：
  - `episode-list.tsx`：列表的列、剧本状态的文字与图标、空状态，全部照抄笔记。转换状态取自列表响应中的 `conversion`；`draft` 为 true 时显示「导入未完成」。
  - `episode-dialog.tsx`：
    - 新建：集号默认为最大集号加 1，空列表时为 1；409 错误显示在集号字段下方；创建后跳转到剧本页；
    - 修改：可以改集号和标题；
    - 删除：确认文案照抄笔记；
    - 「在本集新建创作页」：打开现有的新建创作页对话框，并预选本集。

  「新建剧集」按钮只在剧集 Tab 显示。

  — 验证：组件测试覆盖以下几点：空状态文案；默认集号为最大值加 1；409 错误显示在集号字段下；创建后路由跳转到 `/projects/$id/episodes/$eid`；删除时请求为 `DELETE`，成功后列表刷新；`draft` 和 `conversion.status` 对应的状态文字。
- [ ] T5 修改创作页对话框：新建和重命名时增加「所属剧集」下拉框，使用 `native-select`，第一项是「不属于任何剧集」。重命名时只提交有变化的字段。创作页卡片显示所属剧集的 `episodeLabel`。

  — 验证：组件测试覆盖：新建时选择剧集后，请求体带 `episodeId`；只修改所属剧集时，请求体只有 `episodeId`。
- [ ] T6 修改 `project-tree.tsx`：项目展开后，按以下顺序显示：
  1. 剧集，按集号排序，每集可以展开；子项为「剧本」链接，以及 `episodeId` 等于该集的创作页；
  2. 未分集的创作页，样式与现在一致。

  剧集和创作页都没有时，显示「无内容」。当前所在的链接高亮。

  — 验证：修改 `projects.test.tsx` 中原有的侧栏用例：空项目显示「无内容」；有剧集时，剧集下方显示「剧本」和本集的页面；未分集的页面排在剧集之后；剧本链接指向剧本页路由。
- [ ] T7 新增路由 `routes/projects_.$projectId_.episodes.$episodeId.tsx`：
  - `validateSearch` 接受可选的 `block`（`BlockId`），非法值丢弃；
  - 组件为 `features/projects/script/script-page.tsx`，本子计划只实现面包屑「项目库 / 项目 / 第 N 集 标题」（第二级链接到 `tab=episodes`）、读取剧本时的加载和错误状态，以及一个「编辑器即将可用」占位，由 06 替换。

  修改 `app-shell.tsx` 中 fullBleed 的正则，同时匹配 `/projects/<id>/episodes/<id>`。

  — 验证：路由测试覆盖以下几点：访问剧本路由时，面包屑显示集名；`?block=bad` 被丢弃；进入剧本页后主区不再带 `canvas-grid` 类，这是对外可见的布局行为。
- [ ] T8 修改受影响的 e2e：
  - `e2e/project-canvas.fixture.ts`：进入项目后，先点击「创作页」Tab，再点击页面标题；
  - `e2e/project-tags.test.ts` 的 `openPage`，以及 `e2e/panorama.test.ts` 第 181 行附近，做同样的修改；
  - `e2e/project-library.test.ts`：在键盘切换 Tab 的断言中，从「剧集」Tab 开始按方向键，并更新预期的 Tab 顺序；侧栏中的「第一集」页面现在是未分集页面，断言保持不变。

  — 验证：先运行 `pnpm --filter @frame-loom/engine... build` 和 `pnpm --filter @frame-loom/desktop build`，然后运行 `pnpm --filter @frame-loom/desktop exec playwright test e2e/project-library.test.ts e2e/canvas-shell.test.ts e2e/project-tags.test.ts e2e/panorama.test.ts`，全部通过。`canvas-shell` 用于代表所有使用 fixture 的测试，其余使用 fixture 的 e2e 不在这里运行。

## 验证

- 预期：
  - `pnpm --filter @frame-loom/desktop typecheck` 通过；
  - `pnpm --filter @frame-loom/desktop exec vitest run --project renderer src/renderer/src/app src/renderer/src/features/projects` 通过；
  - `pnpm lint` 中与改动文件相关的规则没有报错（可以对改动文件执行 `pnpm exec eslint <文件>`）；
  - T8 中的四个 e2e 通过。
- 实际：未执行。

## 进度

- 2026-10-29：创建子计划草稿。

## 发现与偏差

无。

## 交接

依赖 02，尚未开始。
