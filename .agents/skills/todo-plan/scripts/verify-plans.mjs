#!/usr/bin/env node
/**
 * 校验 .agents/plans/ 实施计划：路径形态、头块、状态、章节、步骤、父子一致性与链接。
 * 运行：node .agents/skills/todo-plan/scripts/verify-plans.mjs [--plans <目录>] [--notes <目录>]
 * 规则说明见同 Skill 的 SKILL.md；本脚本只检查机械约束，不判断计划内容是否合理。
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const STATUS_RE = /^Status: (draft|active|done|blocked — \S.*|dropped — \S.*)$/u;
const TOPIC = '\\d{4}-\\d{2}-\\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*';
const SINGLE_RE = new RegExp(`^${TOPIC}\\.md$`, 'u');
const DIR_RE = new RegExp(`^${TOPIC}$`, 'u');
const CHILD_RE = /^(\d{2})-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/u;
const STEP_RE = /^- \[( |x|-)\] (T\d+) \S/u;
const LINK_RE = /\[[^\]]*\]\(([^)]+)\)/gu;
const KEYWORDS = new Set(['draft', 'active', 'blocked', 'done', 'dropped']);

/** 各形态必备章节，按顺序出现；允许在其间插入自由章节。 */
export const REQUIRED_SECTIONS = {
  parent: ['## 目标', '## 范围与非目标', '## 子计划', '## 依赖与顺序', '## 验收', '## 发现与偏差'],
  child: ['## 目标', '## 前置条件', '## 步骤', '## 验证', '## 进度', '## 发现与偏差', '## 交接'],
  single: ['## 目标', '## 范围与非目标', '## 前置条件', '## 步骤', '## 验证', '## 进度', '## 发现与偏差', '## 交接'],
};
const CHILD_TABLE_HEADER = ['编号', '子计划', '状态', '依赖', '交付物'];

const isInside = (root, target) => target.startsWith(root + sep);
const keywordOf = (status) => status.split(' ')[0];

/** 归一化换行并标记围栏代码块，避免示例代码被当成结构解析。 */
function parseSource(raw) {
  const lines = raw.replace(/^\uFEFF/u, '').replace(/\r\n?/gu, '\n').split('\n');
  const fenced = [];
  let inFence = false;
  for (const line of lines) {
    const toggles = /^\s{0,3}```/u.test(line);
    fenced.push(inFence || toggles);
    if (toggles) inFence = !inFence;
  }
  return { lines, fenced };
}

/** 返回某个二级章节的正文行（不含围栏代码）。 */
function sectionLines(src, heading) {
  const out = [];
  let inside = false;
  src.lines.forEach((line, i) => {
    if (src.fenced[i]) return;
    if (line.startsWith('## ')) {
      inside = line.trimEnd() === heading;
      return;
    }
    if (inside) out.push(line);
  });
  return out;
}

function parsePlan(file, kind, ctx) {
  const rel = relative(ctx.base, file).split(sep).join('/');
  const fail = (msg) => ctx.errors.push(`plan: ${rel} — ${msg}`);
  const src = parseSource(readFileSync(file, 'utf8'));
  const { lines } = src;

  if (!/^# Plan: \S/u.test(lines[0] ?? '')) fail('第 1 行必须是 `# Plan: <标题>`');
  if (lines[1] !== '') fail('第 2 行必须为空行');
  const statusMatch = STATUS_RE.exec(lines[2] ?? '');
  if (!statusMatch) fail('第 3 行必须是 `Status: draft|active|done`，或 `Status: blocked|dropped — <原因>`');
  const status = statusMatch ? keywordOf(statusMatch[1]) : undefined;

  // 头块：Status 之后、首个空行之前只允许 Note: / Parent: 行。
  const notes = [];
  const parents = [];
  let i = 3;
  for (; i < lines.length && lines[i] !== ''; i++) {
    const meta = /^(Note|Parent): (.+)$/u.exec(lines[i]);
    if (!meta) {
      fail(`头块第 ${i + 1} 行只允许 \`Note:\` 或 \`Parent:\``);
      continue;
    }
    (meta[1] === 'Note' ? notes : parents).push(meta[2].trim());
  }
  if (i >= lines.length) fail('头块后必须有空行和正文');

  if (kind === 'child') {
    if (parents.length !== 1 || parents[0] !== 'plan.md') fail('子计划必须且只能有一行 `Parent: plan.md`');
  } else {
    if (parents.length) fail('只有子计划可以写 `Parent:`');
    if (!notes.length) fail('父计划和单文件计划至少需要一行 `Note:`');
  }

  const noteTargets = [];
  for (const note of notes) {
    if (/^无 — \S/u.test(note)) {
      if (notes.length > 1) fail('`Note: 无 — <原因>` 不能与其他 Note 行并存');
      continue;
    }
    if (!note.endsWith('.md') || /^[a-z]+:/iu.test(note)) {
      fail(`Note 必须是指向决策笔记的相对路径，或 \`无 — <原因>\`（得到 ${JSON.stringify(note)}）`);
      continue;
    }
    const target = resolve(dirname(file), note);
    if (!isInside(ctx.notesRoot, target)) fail(`Note 路径不在笔记目录内：${note}`);
    else if (!existsSync(target)) fail(`Note 指向的笔记不存在：${note}`);
    else noteTargets.push(relative(ctx.notesRoot, target).split(sep).join('/'));
  }
  if (kind !== 'child' && status === 'done' && noteTargets.some((t) => t.startsWith('proposed/'))) {
    fail('计划已 done，关联笔记仍在 proposed/；收尾时应同批落地笔记并更新 Note 路径');
  }

  // 必备章节按顺序出现。
  const headings = lines.filter((l, idx) => !src.fenced[idx] && l.startsWith('## ')).map((l) => l.trimEnd());
  let cursor = -1;
  for (const required of REQUIRED_SECTIONS[kind]) {
    const at = headings.indexOf(required, cursor + 1);
    if (at < 0) {
      fail(headings.includes(required) ? `章节顺序错误：${required}` : `缺少章节：${required}`);
    } else {
      cursor = at;
    }
  }

  // 步骤语法与状态约束。
  if (kind !== 'parent') {
    const ids = new Set();
    let open = 0;
    let checked = 0;
    for (const line of sectionLines(src, '## 步骤')) {
      if (!/^\s*- \[/u.test(line)) continue;
      const step = STEP_RE.exec(line);
      if (!step) {
        fail(`步骤格式应为 \`- [ ] T<n> 描述\`，状态只用 [ ]、[x]、[-]：${line.trim()}`);
        continue;
      }
      if (ids.has(step[2])) fail(`步骤编号重复：${step[2]}`);
      ids.add(step[2]);
      if (step[1] === ' ') open++;
      if (step[1] === 'x') checked++;
      if (step[1] === '-' && !/放弃[:：]\s*\S/u.test(line)) fail(`放弃的步骤需写明 \`放弃：<原因>\`：${step[2]}`);
    }
    if (!ids.size) fail('## 步骤 至少需要一条 `- [ ] T1 …`');
    if (status === 'done' && open) fail(`计划已 done，仍有 ${open} 条未完成步骤`);
    if (status === 'draft' && checked) fail('draft 计划尚未开始执行，不应有已勾选步骤');
  }

  // 正文相对链接必须存在（网址与页内锚点除外）。done/dropped 是历史执行记录，
  // 只校验指向计划与笔记的链接，源码随后改名或删除不应让历史计划失败。
  const historical = status === 'done' || status === 'dropped';
  lines.forEach((line, idx) => {
    if (src.fenced[idx]) return;
    for (const match of line.matchAll(LINK_RE)) {
      let target = match[1].trim();
      if (target.startsWith('<') && target.endsWith('>')) target = target.slice(1, -1).trim();
      if (/^(?:[a-z]+:|#)/iu.test(target)) continue;
      const path = target.split('#')[0];
      if (!path) continue;
      const full = resolve(dirname(file), path);
      if (historical && !isInside(ctx.plansRoot, full) && !isInside(ctx.notesRoot, full)) continue;
      if (!existsSync(full)) fail(`链接目标不存在：${target}`);
    }
  });

  return { file, rel, kind, status, src, fail };
}

function verifyFamily(dir, ctx) {
  const relDir = relative(ctx.base, dir).split(sep).join('/');
  const entries = readdirSync(dir, { withFileTypes: true }).filter((e) => !e.name.startsWith('.'));
  const children = new Map();
  let hasParent = false;
  for (const entry of entries) {
    if (entry.isFile() && entry.name === 'plan.md') {
      hasParent = true;
      continue;
    }
    const child = entry.isFile() ? CHILD_RE.exec(entry.name) : null;
    if (!child) {
      ctx.errors.push(`structure: ${relDir}/${entry.name} — 计划目录内只允许 plan.md 与 NN-topic.md，不允许更深层级`);
      continue;
    }
    if (children.has(child[1])) ctx.errors.push(`structure: ${relDir}/${entry.name} — 子计划编号 ${child[1]} 重复`);
    children.set(child[1], entry.name);
  }
  if (!hasParent) {
    ctx.errors.push(`structure: ${relDir}/ — 缺少 plan.md`);
    return 0;
  }
  if (!children.size) ctx.errors.push(`structure: ${relDir}/ — 没有子计划时改用单文件计划 ${relDir}.md`);

  const parent = parsePlan(resolve(dir, 'plan.md'), 'parent', ctx);
  const childPlans = new Map();
  for (const [id, name] of children) childPlans.set(id, parsePlan(resolve(dir, name), 'child', ctx));

  // 子计划表与实际文件、状态一一对应。
  const rows = sectionLines(parent.src, '## 子计划').filter((l) => l.trim().startsWith('|'));
  const cells = (row) => row.trim().replace(/^\||\|$/gu, '').split('|').map((c) => c.trim());
  if (rows.length < 2 || cells(rows[0]).join('|') !== CHILD_TABLE_HEADER.join('|')) {
    parent.fail(`## 子计划 需要表头 | ${CHILD_TABLE_HEADER.join(' | ')} |`);
  }
  const listed = new Map();
  for (const row of rows.slice(2)) {
    const [id, link, rowStatus, deps, deliverable] = cells(row);
    const child = childPlans.get(id);
    if (!/^\d{2}$/u.test(id ?? '') || !child) {
      parent.fail(`子计划表编号无对应文件：${id}`);
      continue;
    }
    if (listed.has(id)) parent.fail(`子计划表编号重复：${id}`);
    listed.set(id, { deps });
    const target = /^\[[^\]]+\]\(([^)]+)\)$/u.exec(link ?? '')?.[1];
    if (target !== children.get(id)) parent.fail(`子计划 ${id} 的链接应为 [标题](${children.get(id)})`);
    if (!KEYWORDS.has(rowStatus)) parent.fail(`子计划 ${id} 的状态列应为 ${[...KEYWORDS].join('/')}`);
    else if (child.status && rowStatus !== child.status) {
      parent.fail(`子计划 ${id} 表内状态 ${rowStatus} 与文件 Status ${child.status} 不一致`);
    }
    if (!deliverable) parent.fail(`子计划 ${id} 缺少交付物`);
    const depIds = deps === '—' || deps === '-' ? [] : (deps ?? '').split(/[,，、]\s*/u);
    listed.get(id).depIds = depIds;
    for (const dep of depIds) {
      if (!childPlans.has(dep)) parent.fail(`子计划 ${id} 依赖不存在的 ${dep}`);
      else if (dep >= id) parent.fail(`子计划 ${id} 只能依赖编号更小的子计划（得到 ${dep}）`);
    }
  }
  for (const id of childPlans.keys()) if (!listed.has(id)) parent.fail(`子计划表缺少 ${id}（${children.get(id)}）`);

  // 父子状态约束。
  const statuses = [...childPlans.values()].map((c) => c.status).filter(Boolean);
  if (parent.status === 'done' && !(statuses.every((s) => s === 'done' || s === 'dropped') && statuses.includes('done'))) {
    parent.fail('父计划 done 需要全部子计划为 done/dropped，且至少一个 done');
  }
  if (parent.status === 'dropped' && !statuses.every((s) => s === 'done' || s === 'dropped')) {
    parent.fail('父计划 dropped 时，未完成的子计划也要显式标为 dropped');
  }
  for (const [id, child] of childPlans) {
    if (parent.status === 'draft' && !['draft', 'dropped'].includes(child.status)) {
      child.fail('父计划仍是 draft，子计划只能是 draft/dropped');
    }
    if (child.status === 'active' && parent.status !== 'active') child.fail('子计划 active 时父计划必须是 active');
    if (child.status === 'blocked' && !['active', 'blocked'].includes(parent.status)) {
      child.fail('子计划 blocked 时父计划必须是 active/blocked');
    }
    if (child.status === 'done') {
      for (const dep of listed.get(id)?.depIds ?? []) {
        if (childPlans.get(dep)?.status !== 'done') child.fail(`依赖的子计划 ${dep} 尚未 done`);
      }
    }
  }
  return 1 + childPlans.size;
}

/** 校验计划目录，返回错误列表与计划文件数。 */
export function verifyPlans({ plansRoot, notesRoot, base = process.cwd() }) {
  const root = resolve(plansRoot);
  const ctx = { errors: [], notesRoot: resolve(notesRoot), plansRoot: root, base: resolve(base) };
  let count = 0;
  if (!existsSync(root)) return { errors: ctx.errors, count };
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = resolve(root, entry.name);
    if (entry.isFile() && SINGLE_RE.test(entry.name)) {
      parsePlan(full, 'single', ctx);
      count++;
    } else if (entry.isDirectory() && DIR_RE.test(entry.name)) {
      if (existsSync(`${full}.md`) && statSync(`${full}.md`).isFile()) {
        ctx.errors.push(`structure: ${entry.name} — 同名单文件计划与计划目录不能并存`);
      }
      count += verifyFamily(full, ctx);
    } else {
      ctx.errors.push(`structure: ${relative(ctx.base, full).split(sep).join('/')} — 应为 yyyy-mm-dd-topic.md 或 yyyy-mm-dd-topic/（topic 使用小写短横线）`);
    }
  }
  return { errors: ctx.errors, count };
}

function parseArgs(argv) {
  const args = { plans: '.agents/plans', notes: '.agents/notes' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--plans' || argv[i] === '--notes') args[argv[i].slice(2)] = argv[++i];
    else throw new Error(`未知参数：${argv[i]}`);
  }
  return args;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  const { errors, count } = verifyPlans({ plansRoot: args.plans, notesRoot: args.notes });
  if (errors.length) {
    for (const error of errors) console.error(error);
    process.exit(1);
  }
  console.log(`ok: ${count} plan file(s) verified`);
}
