import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { verifyPlans } from '../.agents/skills/todo-plan/scripts/verify-plans.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const skill = join(root, '.agents/skills/todo-plan');

const body = {
  single: (steps) =>
    `## 目标\n\n结果。\n\n## 范围与非目标\n\n- 范围：A\n\n## 前置条件\n\n- 无。\n\n## 步骤\n\n${steps}\n\n## 验证\n\n- 预期：通过。\n\n## 进度\n\n- 2026-11-01：创建。\n\n## 发现与偏差\n\n无。\n\n## 交接\n\n无。\n`,
  child: (steps) =>
    `## 目标\n\n结果。\n\n## 前置条件\n\n- 无。\n\n## 步骤\n\n${steps}\n\n## 验证\n\n- 预期：通过。\n\n## 进度\n\n- 2026-11-01：创建。\n\n## 发现与偏差\n\n无。\n\n## 交接\n\n无。\n`,
  parent: (rows) =>
    `## 目标\n\n结果。\n\n## 范围与非目标\n\n- 范围：A\n\n## 子计划\n\n| 编号 | 子计划 | 状态 | 依赖 | 交付物 |\n| --- | --- | --- | --- | --- |\n${rows}\n\n## 依赖与顺序\n\n- 01 → 02\n\n## 验收\n\n- [ ] 汇总\n\n## 发现与偏差\n\n无。\n`,
};

/** 在临时目录建立笔记与计划夹具，返回校验结果。files 的键是相对 .agents/ 的路径。 */
function check(files) {
  const dir = mkdtempSync(join(tmpdir(), 'frame-loom-plans-'));
  try {
    const all = {
      'notes/proposed/process/2026-11-01-demo.md': '# Agent Note: demo\n',
      'notes/implemented/process/2026-11-01-done.md': '# Agent Note: done\n',
      ...files,
    };
    for (const [rel, content] of Object.entries(all)) {
      const full = join(dir, '.agents', rel);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, content);
    }
    return verifyPlans({
      plansRoot: join(dir, '.agents/plans'),
      notesRoot: join(dir, '.agents/notes'),
      base: dir,
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const single = (status, steps, note = '../notes/proposed/process/2026-11-01-demo.md') =>
  `# Plan: 单文件\n\nStatus: ${status}\nNote: ${note}\n\n${body.single(steps)}`;
const child = (status, steps = '- [ ] T1 做事 — 验证：通过') =>
  `# Plan: 子\n\nStatus: ${status}\nParent: plan.md\n\n${body.child(steps)}`;
const row = (id, status, deps = '—') =>
  `| ${id} | [子](${id}-part.md) | ${status} | ${deps} | 交付物 |`;
const family = (
  parentStatus,
  children,
  { note = '../../notes/proposed/process/2026-11-01-demo.md', rows } = {},
) => ({
  'plans/2026-11-01-big/plan.md': `# Plan: 父\n\nStatus: ${parentStatus}\nNote: ${note}\n\n${body.parent(rows ?? children.map(([id, s, deps]) => row(id, s, deps)).join('\n'))}`,
  ...Object.fromEntries(
    children.map(([id, s, , steps]) => [`plans/2026-11-01-big/${id}-part.md`, child(s, steps)]),
  ),
});

test('Skill 自带示例通过校验', () => {
  const result = verifyPlans({
    plansRoot: join(skill, 'examples/plans'),
    notesRoot: join(skill, 'examples/notes'),
    base: root,
  });
  assert.deepEqual(result.errors, []);
  assert.equal(result.count, 5);
});

test('合法计划通过校验', async (t) => {
  const cases = {
    '单文件 draft': { 'plans/2026-11-01-demo.md': single('draft', '- [ ] T1 做事 — 验证：通过') },
    '单文件 done 且笔记已落地': {
      'plans/2026-11-01-demo.md': single(
        'done',
        '- [x] T1 做事\n- [-] T2 其他 — 放弃：不需要',
        '../notes/implemented/process/2026-11-01-done.md',
      ),
    },
    无对应笔记: {
      'plans/2026-11-01-demo.md': single('active', '- [ ] T1 做事', '无 — 纯机械批量迁移'),
    },
    历史计划不校验源码链接: {
      'plans/2026-11-01-demo.md': single(
        'done',
        '- [x] T1 做事\n\n[旧入口](../../src/removed.ts)',
        '../notes/implemented/process/2026-11-01-done.md',
      ),
    },
    代码块内的结构不参与解析: {
      'plans/2026-11-01-demo.md': single(
        'draft',
        '- [ ] T1 做事\n\n```markdown\n## 目标\n- [x] T9 示例\n[x](missing.md)\n```',
      ),
    },
  };
  // 父计划表的状态列只写关键字，原因只在子计划文件里。
  cases['父子计划进行中'] = family(
    'active',
    [
      ['01', 'done', '—', '- [x] T1 做事'],
      ['02', 'active', '01'],
      ['03', 'blocked — 等待选型', '01、02'],
    ],
    {
      rows: [row('01', 'done'), row('02', 'active', '01'), row('03', 'blocked', '01、02')].join(
        '\n',
      ),
    },
  );
  cases['父子计划全部完成'] = family(
    'done',
    [
      ['01', 'done', '—', '- [x] T1 做事'],
      ['02', 'dropped — 不再需要', '01'],
    ],
    {
      note: '../../notes/implemented/process/2026-11-01-done.md',
      rows: [row('01', 'done'), row('02', 'dropped', '01')].join('\n'),
    },
  );
  for (const [name, files] of Object.entries(cases)) {
    await t.test(name, () => assert.deepEqual(check(files).errors, []));
  }
});

test('违规计划被拒绝', async (t) => {
  const okSingle = '- [ ] T1 做事';
  const cases = [
    ['文件名不合规', { 'plans/demo.md': single('draft', okSingle) }, /yyyy-mm-dd-topic/u],
    ['topic 含大写', { 'plans/2026-11-01-Demo.md': single('draft', okSingle) }, /小写短横线/u],
    ['未知状态', { 'plans/2026-11-01-demo.md': single('doing', okSingle) }, /第 3 行/u],
    ['blocked 缺原因', { 'plans/2026-11-01-demo.md': single('blocked', okSingle) }, /第 3 行/u],
    [
      '缺少 Note',
      { 'plans/2026-11-01-demo.md': single('draft', okSingle).replace(/Note: .*\n/u, '') },
      /至少需要一行 `Note:`/u,
    ],
    [
      'Note 指向不存在',
      {
        'plans/2026-11-01-demo.md': single(
          'draft',
          okSingle,
          '../notes/proposed/process/missing.md',
        ),
      },
      /不存在/u,
    ],
    [
      'done 仍指向 proposed',
      { 'plans/2026-11-01-demo.md': single('done', '- [x] T1 做事') },
      /proposed/u,
    ],
    [
      'done 仍有未完成步骤',
      {
        'plans/2026-11-01-demo.md': single(
          'done',
          okSingle,
          '../notes/implemented/process/2026-11-01-done.md',
        ),
      },
      /未完成步骤/u,
    ],
    ['draft 已勾选', { 'plans/2026-11-01-demo.md': single('draft', '- [x] T1 做事') }, /draft/u],
    [
      '步骤编号重复',
      { 'plans/2026-11-01-demo.md': single('active', '- [ ] T1 做事\n- [ ] T1 再做') },
      /重复/u,
    ],
    ['放弃缺原因', { 'plans/2026-11-01-demo.md': single('active', '- [-] T1 做事') }, /放弃/u],
    ['步骤格式错误', { 'plans/2026-11-01-demo.md': single('active', '- [ ] 做事') }, /步骤格式/u],
    [
      '缺少章节',
      { 'plans/2026-11-01-demo.md': single('draft', okSingle).replace('## 交接', '## 备注') },
      /缺少章节：## 交接/u,
    ],
    [
      '章节顺序错误',
      {
        'plans/2026-11-01-demo.md': single('draft', okSingle)
          .replace('## 目标\n\n结果。\n\n', '')
          .replace('## 交接', '## 目标\n\n结果。\n\n## 交接'),
      },
      /顺序/u,
    ],
    [
      '正文死链',
      { 'plans/2026-11-01-demo.md': single('draft', `${okSingle}\n\n[x](missing.md)`) },
      /链接目标不存在/u,
    ],
    [
      '进行中计划的源码死链',
      {
        'plans/2026-11-01-demo.md': single('active', `${okSingle}\n\n[入口](../../src/missing.ts)`),
      },
      /链接目标不存在/u,
    ],
    [
      '历史计划的笔记死链',
      {
        'plans/2026-11-01-demo.md': single(
          'done',
          '- [x] T1 做事\n\n[旧笔记](../notes/implemented/process/missing.md)',
          '../notes/implemented/process/2026-11-01-done.md',
        ),
      },
      /链接目标不存在/u,
    ],
    ['缺 plan.md', { 'plans/2026-11-01-big/01-part.md': child('draft') }, /缺少 plan.md/u],
    ['没有子计划的目录', family('draft', [], { rows: '' }), /单文件计划/u],
    [
      '孙计划目录',
      { ...family('draft', [['01', 'draft']]), 'plans/2026-11-01-big/01-part/plan.md': 'x' },
      /更深层级/u,
    ],
    [
      '子计划缺 Parent',
      {
        ...family('draft', [['01', 'draft']]),
        'plans/2026-11-01-big/01-part.md': child('draft').replace('Parent: plan.md\n', ''),
      },
      /Parent/u,
    ],
    [
      '表内状态不一致',
      family('active', [['01', 'active']], { rows: row('01', 'done') }),
      /不一致/u,
    ],
    [
      '表内缺少子计划',
      family(
        'active',
        [
          ['01', 'active'],
          ['02', 'draft'],
        ],
        { rows: row('01', 'active') },
      ),
      /缺少 02/u,
    ],
    [
      '依赖指向更大编号',
      family(
        'active',
        [
          ['01', 'active'],
          ['02', 'draft'],
        ],
        { rows: [row('01', 'active', '02'), row('02', 'draft')].join('\n') },
      ),
      /编号更小/u,
    ],
    [
      '父 done 子未完成',
      family('done', [['01', 'active']], {
        note: '../../notes/implemented/process/2026-11-01-done.md',
      }),
      /父计划 done/u,
    ],
    ['子 active 父 draft', family('draft', [['01', 'active']]), /draft/u],
    [
      '子 done 依赖未完成',
      family('active', [
        ['01', 'active'],
        ['02', 'done', '01', '- [x] T1 做事'],
      ]),
      /依赖的子计划 01/u,
    ],
  ];
  for (const [name, files, pattern] of cases) {
    await t.test(name, () => {
      const { errors } = check(files);
      assert.ok(
        errors.some((e) => pattern.test(e)),
        `未命中 ${pattern}：\n${errors.join('\n')}`,
      );
    });
  }
});
