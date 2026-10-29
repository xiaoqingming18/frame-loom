# Plan: 设定库 Tab

Status: active
Parent: plan.md

## 目标

项目详情页的设定库 Tab 实现功能笔记「设定库 Tab」一节中的全部内容：

- 分类导航和数量；
- 搜索；
- 全部、待确认、已确认、已忽略四种筛选；
- 卡片宫格；
- 详情抽屉：可编辑字段、各类别的专属字段、出现位置及跳转；
- 确认、合并、删除；
- 批量确认和批量忽略；
- 在已忽略列表中恢复。

## 前置条件

- 03、05 已完成。
- 已阅读 `features/projects/project-assets.tsx` 中工具栏、宫格和空状态的写法，以及 `packages/ui/src/components/dialog.tsx`。

## 步骤

- [ ] T1 新建 `features/projects/story/story-tab.tsx`，替换 05 中的占位：
  - 左侧是分类导航（人物、场景、道具、服装），每类显示数量；
  - 顶部是搜索框（按名称和别名匹配，不区分大小写）和筛选控件（ToggleGroup：全部、待确认、已确认、已忽略）；
  - 主体是卡片宫格：占位缩略图（分类图标加文字「参考图（后续支持）」）、名称、别名 chip、「第 1 集 ×3 场 · 第 2 集 ×1 场」（集名用 `episodeLabel`），以及状态徽标；
  - 选择「已忽略」时，改为列表显示 `ignored` 中的名称，每项带「恢复」按钮；
  - 空状态使用 lucide 图标，配一句说明。

  — 验证：组件测试使用模拟的 `/story` 数据，覆盖以下几点：分类数量正确；筛选「待确认」后只显示待确认的元素；搜索别名能找到对应元素；「已忽略」列表中点击「恢复」，发送的请求体为 `{ kind, name }`。
- [ ] T2 新建 `story/element-drawer.tsx`：
  - 复用 `@frame-loom/ui` 的 Dialog，只把内容定位到右侧，不新增组件；
  - 可编辑字段：名称、别名（以 chip 增删）、描述；人物额外有性别、年龄段、外貌、性格；场景额外有内外和常见时段；
  - 失去焦点或点击「保存」时发送 `PATCH`；遇到 409 时，在对应字段下方显示错误；
  - 「出现位置」从 occurrences 接口读取，按集分组，每条显示一行摘录；点击后跳转到 `/projects/$id/episodes/$eid?block=<blockId>`；
  - 底部操作：「确认」（仅待确认的元素显示）、「合并到…」（只能选择同类元素）、「删除」（先确认，文案照抄笔记）。

  — 验证：组件测试覆盖以下几点：
  - 修改别名后发送 `PATCH`，请求体只包含 `aliases`；
  - 别名冲突返回 409 时，错误显示在别名字段下方；
  - 点击一条出现位置后，路由变为带 `block` 参数的剧本页；
  - 「合并到…」的候选只包含同类元素。
- [ ] T3 批量模式：
  - 工具栏中的「批量选择」打开卡片复选框；
  - 选中后显示「确认 n 项」「忽略 n 项」，调用 `POST /story/batch`；
  - 完成后退出批量模式，并刷新 `storyQuery` 和 `episodesQuery`。

  — 验证：组件测试覆盖：勾选 2 张卡片后点击「确认 2 项」，请求体为 `{ ids: [a, b], action: 'confirm' }`。

## 验证

- 预期：
  - `pnpm --filter @frame-loom/desktop typecheck` 通过；
  - `pnpm --filter @frame-loom/desktop exec vitest run --project renderer src/renderer/src/features/projects/story` 通过；
  - 对改动的文件运行 `pnpm exec eslint` 通过；
  - 在开发模式下，检查明暗两种模式下的设定库 Tab 和抽屉各一次。

  本子计划不运行 e2e。
- 实际：desktop typecheck 通过；story 定向 vitest 1 文件 3 测试通过，覆盖分类计数、搜索别名、状态筛选、恢复、批量确认、字段冲突、出现位置链接和同类合并。明暗视觉检查待集成验收。

## 进度

- 2026-10-29：创建子计划草稿。

## 发现与偏差

无。

## 交接

设定库和详情抽屉已接通，待明暗主题实际验收后收尾。
