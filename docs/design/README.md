# 界面设计稿快照

`home-ui-light.html` 与 `home-ui-black.html` 是 2026-10-24 收到的明亮、暗黑首页设计快照，原样保留，不作为运行时代码。

- 布局、尺寸和间距参照快照；运行时颜色唯一来源是 `apps/desktop/src/renderer/src/styles/theme.css`。
- 原生窗口按钮、用户指定的猫咪 logo、隐藏公告与禁用创作控件等差异，见[主题系统与应用外壳](../../.agents/notes/implemented/feature/2026-10-24-theme-and-app-shell.md)的偏差表。
- `canvas-ui-light.html` 是 2026-10-25 收到的无限画布明亮快照，只参考浮层、底部操作栏、右上工具组、小地图、空画布提示和节点卡片的视觉风格；底部操作栏元素、颜色与交互以[无限画布方案](../../.agents/notes/implemented/feature/2026-10-25-infinite-canvas.md)为准。
- `canvas-image-node.html` 是 2026-10-26 收到的图片节点与输入框快照，只参考图片节点、提示词输入框、模型／参数／数量弹层的 UI/UX；画布背景、工具栏、小地图等公共元素保持现状，取舍见[画布图片节点参数与输入框](../../.agents/notes/implemented/feature/2026-10-26-canvas-image-node.md)。
- `project-library-light.html` 是 2026-10-26 收到的项目库明亮快照，只参考项目库列表、排序菜单、卡片菜单、新建项目弹窗、项目详情两个 Tab 与资产页的 UI/UX；标题栏、侧栏、用户栏、图标与颜色保持现状，取舍见[项目库方案](../../.agents/notes/proposed/feature/2026-10-26-project-library.md)。
- 新设计稿使用新文件名入库，不覆盖旧快照；同时同步决策笔记和实现。
- 后续界面遵守[UI 规范](../ui-guidelines.md)，实现后检查明暗两种模式。
