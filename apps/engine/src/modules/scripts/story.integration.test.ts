import fs from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import {
  EpisodeSummary,
  ProjectSummary,
  StoryElement,
  StoryResult,
  parseScriptText,
  type ScriptDocument,
} from '@frame-loom/contracts';
import { testEngine } from '../../testing/test-engine.js';
import { ProjectStore } from '../projects/project-store.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
async function setup() {
  const s = await testEngine();
  cleanups.push(() => s.close());
  const project = ProjectSummary.parse(
    await (await s.request('/projects', 'POST', { name: '设定库', location: s.directory })).json(),
  );
  const base = `/projects/${project.id}`;
  const episode = EpisodeSummary.parse(
    await (await s.request(`${base}/episodes`, 'POST', { number: 1, title: '' })).json(),
  );
  const script = `${base}/episodes/${episode.id}/script`;
  const story = async () => StoryResult.parse(await (await s.request(`${base}/story`)).json());
  const create = async (kind: string, name: string) =>
    StoryElement.parse(
      await (await s.request(`${base}/story/elements`, 'POST', { kind, name })).json(),
    );
  const save = (document: ScriptDocument, revision = 1) =>
    s.request(script, 'PUT', { revision, document });
  return { s, project, base, episode, script, story, create, save };
}

it('保存同步样例恰好新增十个元素，重复保存不新增，确认更新本集待确认数量', async () => {
  const { s, base, story, save } = await setup();
  const text = await fs.readFile(
    new URL('../../../../../packages/contracts/fixtures/script-sample-01.txt', import.meta.url),
    'utf8',
  );
  const document: ScriptDocument = {
    schemaVersion: 2,
    preface: '',
    appendix: '',
    blocks: parseScriptText(text).blocks,
  };
  expect(await (await save(document)).json()).toMatchObject({ revision: 2, addedElements: 10 });
  expect(await (await save(document, 2)).json()).toMatchObject({ addedElements: 0 });
  const result = await story();
  expect(result.elements.filter((item) => item.kind === 'character')).toHaveLength(4);
  expect(result.elements.filter((item) => item.kind === 'location')).toHaveLength(6);
  expect(await (await s.request(`${base}/episodes`)).json()).toMatchObject([{ pending: 10 }]);
  expect(
    (
      await s.request(`${base}/story/elements/${result.elements[0].id}`, 'PATCH', {
        status: 'confirmed',
      })
    ).status,
  ).toBe(200);
  expect(await (await s.request(`${base}/episodes`)).json()).toMatchObject([{ pending: 9 }]);
});

it('名称和别名唯一，跨类拒绝合并，重定向合并建议且不改剧本文字', async () => {
  const { s, base, project, story, create } = await setup();
  const a = await create('character', '林夏');
  const b = await create('character', '小林');
  const c = await create('character', '小夏');
  const location = await create('location', '天台');
  expect(
    (await s.request(`${base}/story/elements`, 'POST', { kind: 'character', name: '林夏' })).status,
  ).toBe(409);
  expect(
    (await s.request(`${base}/story/elements/${a.id}`, 'PATCH', { aliases: ['小林'] })).status,
  ).toBe(409);
  expect(
    await (
      await s.request(`${base}/story/elements/${a.id}/merge`, 'POST', { into: location.id })
    ).json(),
  ).toMatchObject({ code: 'ELEMENT_KIND_MISMATCH' });
  expect((await s.request(`${base}/story/elements/${randomUUID()}`, 'DELETE')).status).toBe(404);
  const store = s.app.get(ProjectStore);
  await store.serial(project.id, async () => {
    const file = await store.readStory(project.rootPath);
    for (const element of file.elements)
      if (element.id === c.id || element.id === a.id) element.suggestedMergeInto = b.id;
    await store.writeStory(project.rootPath, { ...file, revision: file.revision + 1 });
  });
  expect(
    (await s.request(`${base}/story/elements/${b.id}/merge`, 'POST', { into: a.id })).status,
  ).toBe(201);
  const merged = await story();
  expect(merged.elements.find((item) => item.id === a.id)).toMatchObject({ aliases: ['小林'] });
  expect(merged.elements.find((item) => item.id === a.id)).not.toHaveProperty('suggestedMergeInto');
  expect(merged.elements.find((item) => item.id === c.id)?.suggestedMergeInto).toBe(a.id);
});

it('忽略全部别名、恢复后跨集同步，批量跳过不存在项且限制五百项', async () => {
  const { s, base, story, create, save } = await setup();
  const person = await create('character', '店主');
  await s.request(`${base}/story/elements/${person.id}`, 'PATCH', { aliases: ['老板'] });
  await s.request(`${base}/story/elements/${person.id}`, 'DELETE');
  expect((await story()).ignored).toEqual([
    { kind: 'character', name: '店主' },
    { kind: 'character', name: '老板' },
  ]);
  const document: ScriptDocument = {
    schemaVersion: 2,
    preface: '',
    appendix: '',
    blocks: [{ id: 'c', type: 'character', text: '店主（OS）' }],
  };
  expect(await (await save(document)).json()).toMatchObject({ addedElements: 0 });
  expect(
    (await s.request(`${base}/story/ignored/restore`, 'POST', { kind: 'character', name: '店主' }))
      .status,
  ).toBe(201);
  const restored = (await story()).elements[0];
  expect(restored).toMatchObject({ name: '店主', status: 'pending' });
  expect(
    (
      await s.request(`${base}/story/batch`, 'POST', {
        ids: [restored.id, randomUUID()],
        action: 'confirm',
      })
    ).status,
  ).toBe(201);
  expect((await story()).elements[0].status).toBe('confirmed');
  expect(
    (
      await s.request(`${base}/story/batch`, 'POST', {
        ids: Array(501).fill(restored.id),
        action: 'ignore',
      })
    ).status,
  ).toBe(400);
  await s.request(`${base}/story/batch`, 'POST', {
    ids: [restored.id, restored.id],
    action: 'ignore',
  });
  expect((await story()).elements).toEqual([]);
});

it('跨集出现位置按场去重、注释不匹配、外部修改和合并使缓存更新', async () => {
  const { s, base, project, episode, story, save, create } = await setup();
  const document: ScriptDocument = {
    schemaVersion: 2,
    preface: '',
    appendix: '',
    blocks: [
      { id: 'scene', type: 'scene', text: '天台' },
      { id: 'a', type: 'action', text: '林夏 小林 林夏' },
      { id: 'note', type: 'note', text: '林夏' },
    ],
  };
  await save(document);
  const person = await create('character', '林夏');
  const alias = await create('character', '小林');
  const second = EpisodeSummary.parse(
    await (await s.request(`${base}/episodes`, 'POST', { number: 2, title: '' })).json(),
  );
  await s.request(`${base}/episodes/${second.id}/script`, 'PUT', { revision: 1, document });
  const result = (await story()).elements.find((item) => item.id === person.id)!;
  expect(result.mentions).toBe(4);
  expect(result.episodes).toEqual([
    { episodeId: episode.id, scenes: 1 },
    { episodeId: second.id, scenes: 1 },
  ]);
  const store = s.app.get(ProjectStore);
  const read = vi.spyOn(store, 'readScript');
  await story();
  expect(read).not.toHaveBeenCalled();
  const path = join(project.rootPath, '.frameloom/scripts', `${episode.id}.json`);
  const original = await fs.readFile(path, 'utf8');
  await fs.writeFile(path, original.replace('林夏 小林 林夏', '林夏 小林'));
  expect((await story()).elements.find((item) => item.id === person.id)?.mentions).toBe(3);
  expect(read).toHaveBeenCalledTimes(1);
  await s.request(`${base}/story/elements/${alias.id}/merge`, 'POST', { into: person.id });
  expect((await story()).elements.find((item) => item.id === person.id)?.mentions).toBe(5);
  const occurrences: unknown = await (
    await s.request(`${base}/story/elements/${person.id}/occurrences`)
  ).json();
  expect(occurrences).toHaveLength(5);
  expect(occurrences).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ episodeId: episode.id, blockId: 'a', sceneId: 'scene' }),
    ]),
  );
});
