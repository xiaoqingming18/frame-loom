# Plan: Markdown 渲染与回写

Status: done
Parent: plan.md

## 目标

新建 `packages/contracts/src/script-markdown.ts`，实现 `renderScriptMarkdown(doc)` 和 `applyMarkdownEdit(oldDoc, oldText, newText, newId?)`，规格见笔记「Markdown 视图」一节中的渲染和回写两部分。两个函数都是纯函数，desktop 直接调用。

## 前置条件

- 01 已完成。
- 已阅读笔记的「Markdown 视图」「前言与附录」中关于区域标记的说明，以及「规则解析器」中的规则 12、16。

## 步骤

- [x] T1 实现 `renderScriptMarkdown(doc) → { text, lineBlocks }`，按笔记逐项实现：
  - 每种段落类型的单行渲染格式；
  - 场序号；
  - spaceLabel 和时间中文名的映射；
  - 段落之间的分隔规则；
  - 前言、附录和两个区域标记；
  - 文件以换行结尾。

  — 验证：单测覆盖以下几点：
  - 每种段落类型的渲染结果，以快照字符串断言；
  - 对白组内只换行、不空行；
  - 场标题前面加 `---`；
  - 前言或附录为空时不写出对应部分，`<!-- 正文 -->` 总是写出；
  - `lineBlocks` 的长度等于行数，并且每个段落 id 恰好出现一次。
- [x] T2 往返性质测试：对两份样例的规则解析结果 `doc`，令 `md = renderScriptMarkdown(doc).text`，断言 `parseScriptText(md)` 的前言、附录与 `doc` 相同，并且逐段比较的 type、text、attrs 也相同（不比较 id、src、review）。

  — 验证：两份样例都通过。如果不通过，说明渲染格式与解析规则不一致，以笔记为准修改其中一方；如果笔记本身有矛盾，按父计划「执行纪律」第 2 条处理。

  已知的规范化差异：01 中 `retypeBlock` 可以产生空文字的非 scene 段落，这类段落在往返之后会丢失，测试中排除这种情况。
- [x] T3 实现 `applyMarkdownEdit`：
  - 先用比对键（去掉开头的 `**N.` 场序号）做逐行 LCS；
  - 没有改动的行沿用旧段落，类型、属性、review 和 id 全部不变；
  - 改动区域中，旧行数和新行数相同时按顺序配对，满足「一对一」条件的沿用 id 并清除 review；
  - 其余的行使用新解析的段落；
  - 最后删除所有 `src`，并用 `ScriptDocument.parse` 校验；
  - 返回 `{ document, unsure }`，`unsure` 是新文本中存疑的行号；
  - 代码中按笔记写上 `shortcut:` 注释。

  — 验证：单测覆盖以下几点：
  1. 两份样例都满足 `applyMarkdownEdit(doc, md, md).document` 等于去掉 `src` 之后的 `doc`；
  2. 修改一行对白的文字后，只有这一段的 text 改变，id 不变；
  3. 在第 2 场之前插入一个新的场标题和一行动作后，原有段落的 id 全部保留，新场出现在正确的位置，之后各场的标题渲染出的序号加 1；
  4. 删除一个对白组后，其余段落的 id 不变；
  5. 写入一行无法识别的内容（例如 `周屿 你好` 这种省略冒号的写法），对应段落带 review，并出现在 `unsure` 中；
  6. 把一行 `**影娘**` 改成 `**影娘**（画外）` 后，这个 character 段落的 id 不变，extension 变为「画外」；
  7. 结果超过 5000 段时，抛出 zod 错误。

## 验证

- 预期：`pnpm --filter @frame-loom/contracts test` 和 `pnpm --filter @frame-loom/contracts typecheck` 通过。不运行其他包的测试。
- 实际：contracts test 322 项通过，contracts typecheck 通过。

## 进度

- 2026-10-30：创建子计划草稿。
- 2026-10-30：完成单行渲染、区域边界、LCS 回写和两份样例往返验证。

## 发现与偏差

无。

## 交接

无。
