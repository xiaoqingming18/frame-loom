# Agent Note: 项目标签

Status: implemented

## Problem

创作页画布中的图片、视频节点越来越多，用户需要按用途（道具、人物、场景等）或状态（最终版、待定版）给节点打标签。需求如下，均已与用户逐项确认：

- 标签属于项目，不属于某个创作页。同一项目的全部创作页共用一份标签列表。「资产」在本篇仅指画布内可打标签的节点，不包括项目资产 Tab 中的文件。
- 节点右键菜单增加「标签」，点击后弹出「标签列表」悬浮卡片，样式对齐用户 2026-10-27 提供的截图：
  - 标题「画布标签」。
  - 色点 + 名称列表，分隔线。
  - 底部为「标签名」输入框和「+ 添加」按钮（截图中的「关键词」改为「标签名」）。
- 内置 7 个标签：道具、音色、场景、服装、人物、最终版、待定版。用户可以添加自定义标签并选择颜色。
- 内置标签和自定义标签都可以删除。鼠标移入行时，右侧显示删除图标；自定义标签同时显示编辑图标，可以改名和改色。内置标签不能编辑，删除后不提供恢复入口。
- 删除时检查全部创作页中引用该标签的节点：
  - 有引用时弹窗列出全部引用。每行可以改为其他标签或「无标签」，顶部提供「全部改为 X」。
  - 全部引用都改完后才能删除。
- 打过标签的节点，在标题栏右侧显示标签徽标，徽标的文字和底色使用标签颜色（对齐用户截图二）。
- 一个节点最多一个标签。
- 支持多选批量打标签。卡片中显示当前选中态，并提供「移除标签」。
- 目前只有图片、视频节点可以打标签。后续的音频、文本节点也要支持，架构上要做到新增节点类型时改动最少。
- 锁定的节点不能在画布内打标签或改标签，与重命名一致。删除标签的引用弹窗例外：锁定节点照常列出，可以改派，否则标签可能因锁定节点而永远删不掉。
- 标签名 1–10 个字符，在项目内不区分大小写去重（含内置标签），每个项目最多 50 个标签（含内置）。
- 跨项目粘贴或导入 JSON 时，节点的标签 id 在当前项目中存在就保留；不存在时，仅可借助剪贴板或导入载荷中的 id／名称旁表，按名称匹配本项目的标签，匹配不到就清空。外部改动没有名称旁表，加载时直接清理不存在的标签 id，不尝试按名称匹配。
- 颜色只能从预设色板中选择，不提供任意取色器。
- 加字段后不升级 `formatVersion`。
- 删除标签和其他创作页的改动不能撤销；当前创作页的打标签、改标签可以撤销。
- 改名和改色立即作用于全部创作页。
- 不做按标签筛选或高亮、小地图或「整理」按标签排序、项目资产 Tab 显示标签。

现状约束：

- 项目文件夹是事实来源。`.frameloom/project.json` 的 `ProjectManifest` 是 `passthrough`，同一项目的所有写操作经 engine 按项目 id 串行（[项目库](../../implemented/feature/2026-10-26-project-library.md)）。
- 画布包 `@frame-loom/canvas` 不感知项目，外部能力全部通过 `CanvasHost` 注入（[无限画布](../../implemented/feature/2026-10-25-infinite-canvas.md)）。
- `CanvasNode` 是 `strictObject`。旧版本应用读到带新字段的文档会拒绝打开；应用尚未发布，用户已接受这一点。
- 当前页由 desktop 宿主的 `createCanvasPersistence` 持有 revision 与保存队列，其他页没有打开的编辑器。应用是单窗口单实例。
- UI 规范禁止任意值颜色，新颜色要在 `theme.css` 中同时定义明暗值（[UI 规范](../../../../docs/ui-guidelines.md)）。
- 剪贴板载荷与导出 JSON 仍不包含项目信息；标签实现增加可选的 id／名称旁表，供目标项目匹配。

## Decision

### 数据格式

`packages/contracts/src/projects.ts` 新增：

```ts
TagColor = z.enum(['red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'indigo', 'purple', 'pink', 'gray']);
TagId = z.string().regex(/^[a-z0-9-]{1,64}$/);         // 内置为固定 slug，自定义为 uuid
TagName = z.string().trim().refine(1–10 个码点);
ProjectTag = z.strictObject({ id: TagId, name: TagName, color: TagColor, builtin: z.boolean() });
ProjectManifest.tags?: ProjectTag[]                      // 最多 50，id 与名称（不区分大小写）唯一
```

- 内置标签的 id、名称和颜色固定：

  | id | 名称 | 颜色 |
  | --- | --- | --- |
  | `builtin-prop` | 道具 | blue |
  | `builtin-voice` | 音色 | purple |
  | `builtin-scene` | 场景 | orange |
  | `builtin-costume` | 服装 | indigo |
  | `builtin-character` | 人物 | pink |
  | `builtin-final` | 最终版 | green |
  | `builtin-pending` | 待定版 | yellow |

- 清单没有 `tags` 字段时，视为内置 7 个标签，由 contracts 的 `projectTags(manifest)` 统一解释。下次写清单时写出该字段，读取时不额外写盘。`tags: []` 表示用户删光了全部标签，和缺省含义不同。新建项目直接写出内置列表。
- 内置 id 固定，所以清单补写前后，节点引用都稳定。
- 节点只存 id：`CanvasNode.tagId?: TagId`，和 `title`、`locked` 同级。改名、改色不改写页面文件。
- 可打标签的节点类型只有一个来源：contracts 的 `TAGGABLE_NODE_TYPES = ['image', 'video']`。
  - `CanvasDocument` 校验拒绝非这些类型的节点携带 `tagId`。
  - 画布包用 `isTaggable(node)` 决定菜单、徽标与批量范围。
  - 以后新增音频、文本节点时，只需在常量中加一项，并在节点视图里使用公共头部组件。注册表不再另设 `taggable` 声明，避免两份白名单漂移。

### engine 接口

新增 `apps/engine/src/modules/projects/project-tags.service.ts`，挂在现有 projects 模块下。全部操作在 `store.serial(projectId)` 内执行：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/projects/:id/tags` | 返回 `projectTags(manifest)` |
| POST | `/projects/:id/tags` | `{ name, color }`，自定义 id 用 uuid，返回新列表 |
| PATCH | `/projects/:id/tags/:tagId` | `{ name?, color? }`，内置标签返回 `TAG_BUILTIN_READONLY` |
| GET | `/projects/:id/tags/:tagId/usages` | 扫描全部页面文件，返回 `{ pageId, pageName, nodeId, nodeType, title, locked, thumbnailSha256 }[]` |
| POST | `/projects/:id/tags/:tagId/delete` | `{ reassign: { pageId, nodeId, tagId \| null }[] }`，返回新列表 |

删除接口的行为：

1. 在同一个串行操作内，先按 `reassign` 改写其他页面：只修改当前 `tagId` 仍等于被删标签的节点，锁定节点照常修改，revision 加 1，并修复清单摘要。
2. 重新扫描全部页面。仍有引用时返回 409 `TAG_IN_USE`，附带最新引用列表。
3. 没有引用时，从清单中移除该标签。
4. 如果页面已改写，但清单写入失败，标签仍然存在，引用已经迁走，重试即可，不会丢数据。

错误码：`TAG_NAME_CONFLICT`、`TAG_LIMIT_EXCEEDED`、`TAG_NOT_FOUND`、`TAG_BUILTIN_READONLY`、`TAG_IN_USE`。`reassign` 的目标标签必须存在，且不能是被删的标签。

### 画布包

- `CanvasHost.tags?`：

  ```ts
  list(signal): Promise<ProjectTag[]>;
  create(input): Promise<ProjectTag[]>;
  update(id, patch): Promise<ProjectTag[]>;
  remove(tag): Promise<ProjectTag[] | null>;   // 宿主主导删除流程，取消返回 null
  ```

  没有注入 `tags` 时，菜单项和徽标都不出现。
- store 增加 `tags: ProjectTag[] | null`。编辑器挂载时加载，每次宿主操作后用返回的列表替换。注入标签能力但列表尚未加载时阻止粘贴和导入并提示，避免用空列表匹配而静默丢失标签；加载失败后也保持这一保护。
- 命令 `setTag(document, nodeIds, tagId | null)`：
  - 只作用于可打标签、未锁定（含所在分组未锁定）的节点。
  - 一次 `apply` 完成，可撤销。
  - 复制、原地复制、生成回写都保留 `tagId`。
- 右键菜单「标签」：选区内没有可打标签且未锁定的节点时置灰。点击后，在菜单坐标处打开 Popover（`@frame-loom/ui` 的 popover）。
- 卡片内容：
  - 行按钮带 `aria-pressed`。选区内可打标签节点的标签全部相同时，对应行显示对勾。
  - 点击某一行，为选区打上该标签并关闭卡片。
  - 「移除标签」行只在选区内有任一节点带标签时可用。
  - 行悬停或 `focus-within` 时，在右侧显示编辑（仅自定义标签）和删除图标，图标按钮带中文可访问名称。
  - 编辑采用行内名称输入加色板。
  - 底部「标签名」输入框加「+ 添加」，展开色板后选择颜色。
  - 名称冲突、超出上限等错误在卡片内就地显示。
- 抽出公共节点头部 `NodeHeader`（标题、标签徽标、锁定、参考数量），`MediaFrame` 改用它，后续节点直接复用。
  - 徽标是圆角胶囊，使用标签色的浅底和深字。
  - 空间不足时先截断标题，徽标本身最大宽度也截断。
  - 节点的 `tagId` 不在当前列表中时，按「无标签」显示。
- 标签色 token 在 `theme.css` 中定义：`--tag-<color>`（色点与文字）和 `--tag-<color>-bg`（徽标底），每个都有明暗两套值；`styles.css` 映射为类名。
- 跨项目来源的处理（规则 A，按名称匹配，匹配不到就清空）：
  - 剪贴板载荷新增可选 `tags: { id, name }[]`，复制时从 store 写入被复制节点所用标签。
  - 导出 JSON 在文档旁增加同样的 `tags` 字段，导入时先取出 `tags`，再按 `CanvasDocument` 校验其余部分。旧文件没有该字段，可以照常导入。
  - 粘贴或导入时，`tagId` 在当前项目中存在就保留；不存在时按旁表中的名称，不区分大小写匹配；匹配不到就删除 `tagId`。
- 加载页面时，宿主先取标签列表，再把 `tagId` 不在列表中的节点清空（外部改动、他处删除导致的悬空引用），然后 `reset`。
  - 这一步不进入历史，也不标记为未保存。清理结果随下次保存落盘。
  - 撤销到删除标签之前的快照时，节点上恢复出的悬空 id 同样按「无标签」显示，下次加载时被清理。

### desktop 宿主与删除弹窗

`project-canvas.tsx` 注入 `host.tags`。增删改都调用 engine 接口，并刷新 `project-queries.ts` 中的标签查询。

删除流程 `remove(tag)`：

1. `persistence.flush()` 失败时中止，并显示现有的保存错误提示。
2. 调用 `usages` 接口。
3. 没有引用时：确认框提示「删除后不可恢复」（内置标签同样不可恢复），确认后调用删除接口，`reassign` 为空。
4. 有引用时：打开引用弹窗（复用 Dialog）。
   - 每行显示缩略图、标题、所在创作页，以及一个目标下拉。下拉选项为其他标签或「无标签」。
   - 锁定节点同样可以改派，该行显示锁定图标（带「已锁定」可访问名称）。锁定只约束画布内编辑，不约束项目级标签管理。
   - 顶部提供「全部改为 X」。
   - 每行都选好目标后，「删除」按钮才可用。
5. 确认删除：
   - 当前页的行通过 `persistence.store` 一次 `apply` 修改（可撤销），然后再次 `flush`。这次修改直接改写节点 `tagId`，不经过跳过锁定节点的 `setTag`。
   - 其他页的行作为 `reassign` 提交给删除接口。
   - 收到 409 `TAG_IN_USE` 时，用最新列表刷新弹窗。
6. 弹窗不提供跳转到节点的功能。

### 不变量

- 正常赋值与改派只引用本项目清单中的标签；悬空引用一律显示为「无标签」。撤销允许恢复已删除标签的 id，甚至随保存短暂落盘；下次加载清理，不承诺页面文件在所有时刻都没有悬空引用。
- engine 只在删除接口中、按 `reassign` 改写未打开的页面。当前打开的页面只经画布 store 修改，避免与打开中的编辑器产生 revision 冲突。

## 实施现状

契约、engine 接口、画布交互与 desktop 宿主均已落地。画布标签卡片复用 Popover，删除引用弹窗复用 Dialog 与 NativeSelect；加载清理不产生脏状态。宿主测试覆盖增改同步、保存先于扫描、当前页锁定节点改派且可撤销、只向 engine 提交其他页、409 刷新与重新选择，以及两次保存失败均不发送删除。旧清单普通写入未补齐默认 `tags` 的漏洞已最小修复，新增 2 项回归测试，全量 engine 测试 230 项通过。

明暗 10 色徽标 token 的文字对比度均由主题单测检查，阈值为 4.5:1；明亮黄色前景调整为 `#854d0e`，避免原值对浅底仅 4.42:1。全仓 `pnpm test` 738 项通过（contracts 191、engine 230、canvas 128、desktop 189），`pnpm typecheck`、`pnpm lint` 通过。

Electron `project-tags` e2e 与项目库、画布持久化回归共 4 项通过，耗时 36.3s，覆盖两页标签同步、真实 engine 409、重试删除、磁盘与重启校验。明暗与窄窗口截图由 Agent 逐图目检，键盘路径使用 Electron 真实事件验证，详见下文。功能实施与本轮专项验收已完成。

## Alternatives considered

- **节点上直接存标签名和颜色，不建项目级列表**：最强理由是没有跨文件一致性问题，复制到哪里都自带完整信息。不选的原因：用户要求标签属于项目，改名、改色、删除都要作用于全部创作页。这样做每次都要改写所有页面文件，而且无法维护统一的列表。
- **标签列表单独存为 `.frameloom/tags.json`**：最强理由是与清单的写入互不影响，文件职责更单一。不选的原因：清单本来就是 `passthrough`，并且经同一串行队列写入；多一个文件，就多一处非事务的跨文件写入和一处格式版本。标签数量受 50 个上限约束，放在清单里不会明显增大清单体积。
- **标签存在应用 SQLite 中**：最强理由是查询和更新简单。不选的原因：项目库规定项目文件夹是事实来源，数据库只存可重建的本机状态。标签存在数据库里，会让「打开已有项目」或换机器后标签丢失。
- **删除时由 engine 统一改写包括当前页在内的全部页面**：最强理由是只有一条写路径，实现最短。不选的原因：当前页编辑器持有的 revision 会立即冲突（409），只能重新加载，这样会丢失撤销历史，也违背「当前页改动可撤销」。
- **可打标签能力在注册表 `NodeTypeDefinition.taggable` 声明，contracts 另设常量**：这是上一轮沟通时的设想，最强理由是节点能力集中在注册表。不选的原因：engine 和文档校验无法依赖画布注册表，必然需要 contracts 常量，两份白名单会漂移。改为只以 contracts 常量为准，画布侧派生。
- **允许任意颜色**：最强理由是自由度高。不选的原因：违反 UI 规范的 token 约束，暗黑模式对比度无法保证。用户已确认使用预设色板。

## Verification

- contracts 单测覆盖以下内容：
  - 标签 schema、名称长度与去重、50 个上限。
  - 缺省 `tags` 解释为内置列表。
  - 非可打标签类型携带 `tagId` 时被拒绝。
- engine 集成测试覆盖以下内容：
  - 增、改、查、删。
  - 内置标签不能编辑。
  - 跨两个页面的引用扫描。
  - 带 `reassign` 删除后，页面 revision 递增，锁定节点同样被改派。
  - 残留引用返回 409。
  - 旧清单没有 `tags` 时的读取和补写，包括普通清单写入补齐默认标签的 2 项回归；全量 engine 230 项通过。
  - 写入失败时不丢失页面。
- 画布单测与组件测试覆盖以下内容：
  - 批量打标签时跳过锁定节点和不可打标签节点，结果可撤销。
  - 选中态与「移除标签」。
  - 剪贴板与导入的按名称匹配和清空。
  - 加载时清理悬空引用。
  - 徽标渲染与标题截断。
- desktop 组件测试覆盖删除弹窗：逐行修改、全部改为、未全部选择时禁用、409 后刷新、锁定节点可改派并显示锁定图标。
- Electron `project-tags` e2e 1 项通过（最近一次 10.9s）：
  - 在两个创作页通过 UI 给节点打同一个自定义标签，跨页改名、改为紫色，确认两页徽标同步；另一页节点锁定后，画布「标签」菜单置灰。
  - 使用 Tab、Enter、Space 验证菜单 → 标签卡片 → 编辑图标／色板／保存／删除 → Dialog 的操作及焦点交接；这是 Electron 真实键盘事件覆盖，不是 jsdom 组件事件，也不冒充真人物理键盘验收。
  - 删除弹窗中，使用 Alt+ArrowDown 打开原生 select，再以 End、ArrowUp、Enter 选择「最终版」，将全部引用改派到该标签。
  - 真实 engine 因新增引用返回 409，弹窗重新扫描并要求重新选择；重试删除成功，磁盘文件与重启后两页徽标正确。
- 视觉证据在 `.cache/project-tags/`：`card/edit/delete/badge-{light,dark}-{1120,720}.png`，以及 `locked-menu.png`、`name-conflict-dark-720.png`、`delete-conflict-dark-720.png`。Agent 已逐图核对明暗主题、1120 宽与 720×560 最小窗口的卡片、编辑、删除和徽标，以及锁定菜单、名称冲突、删除冲突状态；这是 Agent 逐图目检，不是真人视觉验收。
- 全仓 `pnpm test` 738 项、`pnpm typecheck`、`pnpm lint` 通过；`pnpm format:check`、`pnpm run verify` 与 `git diff --check` 通过。
- `pnpm --filter @frame-loom/desktop test:e2e project-tags canvas-persistence project-library` 共 4 项通过（36.3s），包含项目生命周期及保存、故障救援回归。
- 未执行本轮加固安装包／CSP 复验，也未执行真人物理键盘、读屏或原生中文输入法验收；Electron e2e 与截图不替代这些检查。

## Consequences

- 收益：项目级列表让改名与改色作用于全部创作页，无须改写页面；节点只存 id，画布包仍通过宿主能力解耦项目存储，contracts 常量统一可打标签类型，后续节点复用公共头部即可接入。
- 收益：删除前保存、跨页扫描与 409 重扫阻止静默漏改引用；当前页改派可撤销，锁定节点可在项目级弹窗改派，避免标签因锁定而无法删除。缺省内置列表兼容旧清单，显式空列表保留用户删光标签的选择。
- 代价：删除需要当前页保存与其他页改写两条路径，以及跨文件失败后的重试处理；当前单窗口单实例和最多 50 个标签约束下采用串行操作及全页扫描，不引入跨文件事务。若出现多编辑器并发或扫描成为瓶颈，需要重新评估并发协议与索引。

- 旧版本应用无法打开带 `tagId` 的页面文件（用户已接受，未发布）。发布后再改节点结构，就需要走 `formatVersion` 迁移。
- 删除接口在页面改写与清单写入之间崩溃时，引用已迁走但标签仍在。这对用户可见，但不丢数据，重试即可删除。
- 撤销可能把已删除标签的 id 恢复到当前页并保存到磁盘。这类 id 显示为「无标签」，下次加载时清理；这段时间里，页面文件中会短暂存在悬空 id。
- 删除弹窗可以改派锁定节点的标签，用户可能没意识到这里会绕过锁定。行内锁定图标是唯一的提示，用户已确认接受这一点。
