# 界面设计稿快照

`home-ui-light.html` 与 `home-ui-black.html` 是 2026-10-24 收到的明亮、暗黑首页设计快照，原样保留，不作为运行时代码。

- 布局、尺寸和间距参照快照；运行时颜色唯一来源是 `apps/desktop/src/renderer/src/styles/theme.css`。
- 原生窗口按钮、用户指定的猫咪 logo、隐藏公告与禁用创作控件等差异，见[主题系统与应用外壳](../../.agents/notes/implemented/feature/2026-10-24-theme-and-app-shell.md)的偏差表。
- `canvas-ui-light.html` 是 2026-10-25 收到的无限画布明亮快照，只参考浮层、底部操作栏、右上工具组、小地图、空画布提示和节点卡片的视觉风格；底部操作栏元素、颜色与交互以[无限画布方案](../../.agents/notes/implemented/feature/2026-10-25-infinite-canvas.md)为准。
- `canvas-image-node.html` 是 2026-10-26 收到的图片节点与输入框快照，只参考图片节点、提示词输入框、模型／参数／数量弹层的 UI/UX；画布背景、工具栏、小地图等公共元素保持现状，取舍见[画布图片节点参数与输入框](../../.agents/notes/implemented/feature/2026-10-26-canvas-image-node.md)。
- `project-library-light.html` 是 2026-10-26 收到的项目库明亮快照，只参考项目库列表、排序菜单、卡片菜单、新建项目弹窗、项目详情两个 Tab 与资产页的 UI/UX；标题栏、侧栏、用户栏、图标与颜色保持现状，取舍见[项目库方案](../../.agents/notes/implemented/feature/2026-10-26-project-library.md)。
- `juben.html` 是 2026-11-01 收到的标准剧本编辑器明亮快照，来自用户下载目录；仅规范化换行，保留原始布局、样例与脚本作为设计数据，不作为运行时代码。新编辑器、项目级剧本 SQLite 与限定旧数据升级已实施；编辑区／场次大纲的 CSS 尺寸和明暗／断点截图已核对。因本机 Windows 显示缩放为 125%，且本地 `file:` 预览被安全策略拒绝，尚无相同缩放下的原型渲染对照，不能声称像素一致；其余未通过验收项见[标准剧本重构方案](../../.agents/notes/proposed/architecture/2026-11-01-standard-script-rebuild.md)和[总实施计划](../../.agents/plans/2026-11-01-standard-script-rebuild/plan.md)。
- 新设计稿使用新文件名入库，不覆盖旧快照；同时同步决策笔记和实现。
- 项目库的列表、操作弹窗、详情创作页 Tab、项目资产和侧栏项目树已实现；明暗纸张 token 为 `project-paper`／`project-paper-icon`，菜单使用现有 shadcn，图标使用 lucide。项目画布已接入项目页面路由；明暗、资产页和最小窗口截图位于忽略的 `.cache/project-library/`，加固目录版验收记录见同目录 `acceptance.md`。
- 后续界面遵守[UI 规范](../ui-guidelines.md)，实现后检查明暗两种模式。
