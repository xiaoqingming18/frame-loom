import { afterEach, expect, it } from 'vitest';
import {
  EpisodeSummary,
  ProjectSummary,
  ScriptResult,
  StoryElement,
  StoryResult,
  StoryOccurrencesResult,
} from '@frame-loom/contracts';
import { testEngine } from '../../testing/test-engine.js';
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close();
});
async function setup() {
  const s = await testEngine();
  cleanups.push(() => s.close());
  const project = ProjectSummary.parse(
    await (
      await s.request('/projects', 'POST', { name: '设定测试', location: s.directory })
    ).json(),
  );
  const base = `/projects/${project.id}`;
  const episode = EpisodeSummary.parse(
    await (await s.request(`${base}/episodes`, 'POST', { number: 1, title: '' })).json(),
  );
  const url = `${base}/episodes/${episode.id}/script`;
  const record = ScriptResult.parse(await (await s.request(url)).json());
  const doc = {
    ...record.document,
    scenes: [
      {
        id: crypto.randomUUID(),
        scene_id: '1-1',
        location: '便利店',
        time_of_day: '夜' as const,
        interior: true,
        atmosphere: '安静',
        characters: ['林夏', '老陈'],
        beats: [
          {
            id: crypto.randomUUID(),
            type: 'dialogue' as const,
            speaker: '西装男',
            emotion: '',
            line: '林夏，不要开门。',
          },
        ],
      },
    ],
  };
  await s.request(url, 'PUT', { revision: 1, document: doc });
  const story = async () => StoryResult.parse(await (await s.request(`${base}/story`)).json());
  const create = async (kind: string, name: string) =>
    StoryElement.parse(
      await (await s.request(`${base}/story/elements`, 'POST', { kind, name })).json(),
    );
  return { s, project, base, episode, url, doc, story, create };
}
it('S01/S02/S03/S04/S06 精确去重、人物并集、资料保护与改名保留别名', async () => {
  const { s, base, url, doc, story } = await setup();
  const first = await story();
  expect(first.elements.map((e) => e.name).sort()).toEqual(
    ['便利店', '林夏', '老陈', '西装男'].sort(),
  );
  const person = first.elements.find((e) => e.name === '林夏')!;
  const patch = {
    name: '林晚',
    attrs: {
      age: '约30岁',
      appearance: ['黑发'],
      personality: ['谨慎'],
      signatureActions: ['转笔'],
      signatureProps: ['旧钥匙'],
    },
  };
  expect((await s.request(`${base}/story/elements/${person.id}`, 'PATCH', patch)).status).toBe(200);
  const saved = await s.request(url, 'PUT', { revision: 2, document: doc });
  expect(await saved.json()).toMatchObject({ addedElements: 0 });
  const updated = (await story()).elements.find((e) => e.id === person.id)!;
  expect(updated.aliases).toEqual(['林夏']);
  expect(updated.attrs).toEqual(patch.attrs);
  expect(updated.manuallyEdited).toBe(true);
  expect(
    ScriptResult.parse(await (await s.request(url)).json()).document.scenes[0].characters,
  ).toContain('林夏');
  expect(
    (await s.request(`${base}/story/elements`, 'POST', { kind: 'character', name: ' 林夏 ' }))
      .status,
  ).toBe(409);
  expect(
    (await s.request(`${base}/story/elements`, 'POST', { kind: 'location', name: '林夏' })).status,
  ).toBe(201);
});
it('S07 合并冲突必须明确选值，关系重定向且正文保持', async () => {
  const { s, base, url, story, create } = await setup();
  const source = (await story()).elements.find((e) => e.name === '林夏')!;
  const target = await create('character', '林晚');
  await s.request(`${base}/story/elements/${source.id}`, 'PATCH', { attrs: { age: '30' } });
  expect(
    (await s.request(`${base}/story/elements/${source.id}/merge`, 'POST', { into: target.id }))
      .status,
  ).toBe(409);
  expect(
    (
      await s.request(`${base}/story/elements/${source.id}/merge`, 'POST', {
        into: target.id,
        attrs: { age: '30' },
      })
    ).status,
  ).toBe(201);
  const merged = (await story()).elements.find((e) => e.id === target.id)!;
  expect(merged.aliases).toContain('林夏');
  const refs = StoryOccurrencesResult.parse(
    await (await s.request(`${base}/story/elements/${target.id}/occurrences`)).json(),
  );
  expect(refs.length).toBeGreaterThan(0);
  expect(
    ScriptResult.parse(await (await s.request(url)).json()).document.scenes[0].characters,
  ).toContain('林夏');
});
it('S08/S09/S12 忽略不复活、恢复，手工完善 pending 不清理，四类可管理', async () => {
  const { s, base, url, doc, story, create } = await setup();
  const person = (await story()).elements.find((e) => e.name === '老陈')!;
  await s.request(`${base}/story/elements/${person.id}`, 'DELETE');
  await s.request(url, 'PUT', { revision: 2, document: doc });
  expect((await story()).elements.some((e) => e.name === '老陈')).toBe(false);
  await s.request(`${base}/story/ignored/restore`, 'POST', { kind: 'character', name: '老陈' });
  expect((await story()).elements.some((e) => e.name === '老陈')).toBe(true);
  const kept = (await story()).elements.find((e) => e.name === '林夏')!;
  await s.request(`${base}/story/elements/${kept.id}`, 'PATCH', { description: '已完善但未确认' });
  await s.request(url, 'PUT', { revision: 3, document: { ...doc, scenes: [] } });
  expect((await story()).elements.some((e) => e.id === kept.id)).toBe(true);
  const prop = await create('prop', '旧钥匙'),
    costume = await create('costume', '风衣');
  expect(prop.kind).toBe('prop');
  expect(costume.kind).toBe('costume');
});
it('S03/S09/S10 跨集精确复用，动作内已有长名保留，短名不双计，统计不受位置上限截断', async () => {
  const { s, base, url, doc, story, create } = await setup();
  const person = (await story()).elements.find((element) => element.name === '林夏')!;
  const short = await create('character', '林');
  const second = EpisodeSummary.parse(
    await (await s.request(`${base}/episodes`, 'POST', { number: 2, title: '' })).json(),
  );
  const secondUrl = `${base}/episodes/${second.id}/script`;
  const secondDoc = structuredClone(doc);
  secondDoc.scenes[0].id = crypto.randomUUID();
  secondDoc.scenes[0].beats = [
    { id: crypto.randomUUID(), type: 'dialogue', speaker: '林夏', emotion: '', line: '不要开门。' },
  ];
  expect((await s.request(secondUrl, 'PUT', { revision: 1, document: secondDoc })).status).toBe(
    200,
  );
  const actionDoc = {
    ...doc,
    scenes: [
      {
        ...doc.scenes[0],
        characters: [],
        beats: Array.from({ length: 201 }, () => ({
          id: crypto.randomUUID(),
          type: 'action',
          content: '林夏仍然望着门外。',
        })),
      },
    ],
  };
  expect((await s.request(url, 'PUT', { revision: 2, document: actionDoc })).status).toBe(200);
  await s.request(secondUrl, 'PUT', { revision: 2, document: { ...secondDoc, scenes: [] } });
  const result = await story();
  expect(result.elements.find((element) => element.id === person.id)?.mentions).toBe(201);
  expect(result.elements.find((element) => element.id === short.id)?.mentions).toBe(0);
  expect(
    StoryOccurrencesResult.parse(
      await (await s.request(`${base}/story/elements/${person.id}/occurrences`)).json(),
    ),
  ).toHaveLength(200);
  await s.request(url, 'PUT', { revision: 3, document: { ...actionDoc, scenes: [] } });
  expect((await story()).elements.some((element) => element.id === person.id)).toBe(false);
});
