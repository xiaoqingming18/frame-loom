import fs from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import {
  ProjectSummary,
  EpisodeSummary,
  ScriptResult,
  StoryResult,
  ProjectManifest,
  ProjectPageSummary,
  createEditableScript,
  ScriptDocument,
} from '@frame-loom/contracts';
import { testEngine } from '../../testing/test-engine.js';
import { ProjectStore } from '../projects/project-store.js';
import { ProjectScriptDatabase } from '../projects/project-script-database.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const close of cleanups.splice(0).reverse()) await close();
});
async function setup() {
  const s = await testEngine();
  cleanups.push(() => s.close());
  const project = ProjectSummary.parse(
    await (
      await s.request('/projects', 'POST', {
        name: '新剧本',
        location: s.directory,
        profile: { form: null, medium: null, genres: ['都市'], aspect: null, style: '冷色' },
      })
    ).json(),
  );
  const base = `/projects/${project.id}`;
  const response = await s.request(`${base}/episodes`, 'POST', {
    number: 1,
    title: '重逢',
    duration_sec: 120,
  });
  const episode = EpisodeSummary.parse(await response.json());
  const url = `${base}/episodes/${episode.id}`;
  const read = async () => ScriptResult.parse(await (await s.request(`${url}/script`)).json());
  const fixture = ScriptDocument.parse(
    JSON.parse(
      await fs.readFile(
        new URL(
          '../../../../../packages/contracts/fixtures/standard-script-short.json',
          import.meta.url,
        ),
        'utf8',
      ),
    ),
  );
  return { s, project, base, episode, url, read, doc: createEditableScript(fixture) };
}
it('E01/E02/E03 剧集唯一数据库来源、页面归属和最新只读投影', async () => {
  const { s, project, base, episode, url, read, doc } = await setup();
  expect((await s.request(`${base}/episodes`, 'POST', { number: 1, title: '' })).status).toBe(409);
  expect((await s.request(`${url}/script`, 'PUT', { revision: 1, document: doc })).status).toBe(
    200,
  );
  await s.request(`${base}/profile`, 'PUT', {
    form: null,
    medium: null,
    genres: ['悬疑'],
    aspect: null,
    style: '新画风',
  });
  await s.request(url, 'PATCH', { number: 5, title: '新标题', duration_sec: 50 });
  const latest = await read();
  expect(latest.document.meta).toMatchObject({
    series: '新剧本',
    genre: '悬疑',
    style: '新画风',
    episode: 5,
    title: '新标题',
    duration_sec: 50,
  });
  expect(latest.document.scenes.map((s) => s.scene_id)).toEqual(['5-1', '5-2']);
  expect(latest.document.scenes.map((s) => s.id)).toEqual(doc.scenes.map((s) => s.id));
  const page = ProjectPageSummary.parse(
    await (
      await s.request(`${base}/pages`, 'POST', { name: '画布', episodeId: episode.id })
    ).json(),
  );
  expect(page.episodeId).toBe(episode.id);
  expect(
    (await s.request(`${base}/pages`, 'POST', { name: '坏归属', episodeId: crypto.randomUUID() }))
      .status,
  ).toBe(404);
  expect(ProjectManifest.parse(await (await s.request(base)).json()).episodes).toHaveLength(1);
  const disk = ProjectManifest.parse(
    JSON.parse(await fs.readFile(join(project.rootPath, '.frameloom/project.json'), 'utf8')),
  );
  expect(disk.formatVersion).toBe(2);
  expect(disk.episodes).toBeUndefined();
  await expect(fs.stat(join(project.rootPath, '.frameloom/scripts'))).rejects.toMatchObject({
    code: 'ENOENT',
  });
  await s.restart();
  expect((await read()).document).toEqual(latest.document);
});
it('E04/E05/E06 稳定身份、并发 revision、SQL 失败回滚正文及设定', async () => {
  const { s, project, url, read, doc } = await setup();
  const replies = await Promise.all([
    s.request(`${url}/script`, 'PUT', { revision: 1, document: doc }),
    s.request(`${url}/script`, 'PUT', { revision: 1, document: doc }),
  ]);
  expect(replies.map((r) => r.status).sort()).toEqual([200, 409]);
  const moved = { ...doc, scenes: [...doc.scenes].reverse() };
  await s.request(`${url}/script`, 'PUT', { revision: 2, document: moved });
  expect((await read()).document.scenes.map((s) => s.id)).toEqual(moved.scenes.map((s) => s.id));
  const before = await read();
  await s.app
    .get(ProjectScriptDatabase)
    .use(project.rootPath, project.id, (db) =>
      db.exec(
        "CREATE TRIGGER fail_save BEFORE UPDATE OF revision ON episodes BEGIN SELECT RAISE(ABORT,'模拟失败'); END",
      ),
    );
  const failed = { ...moved, scenes: [{ ...moved.scenes[0], location: '回滚地点' }] };
  expect((await s.request(`${url}/script`, 'PUT', { revision: 3, document: failed })).status).toBe(
    500,
  );
  expect((await read()).document).toEqual(before.document);
  expect(
    StoryResult.parse(
      await (await s.request(`/projects/${project.id}/story`)).json(),
    ).elements.some((e) => e.name === '回滚地点'),
  ).toBe(false);
});
it('E08 删集清单失败可重试，页面不删除，回收在库中保留30天', async () => {
  const { s, project, base, episode, url } = await setup();
  const page = ProjectPageSummary.parse(
    await (
      await s.request(`${base}/pages`, 'POST', { name: '保留页面', episodeId: episode.id })
    ).json(),
  );
  const store = s.app.get(ProjectStore);
  const write = vi.spyOn(store, 'writeManifest').mockRejectedValueOnce(new Error('模拟写失败'));
  expect((await s.request(url, 'DELETE')).status).toBe(500);
  expect((await s.request(`${url}/script`)).status).toBe(200);
  write.mockRestore();
  expect((await s.request(url, 'DELETE')).status).toBe(200);
  expect((await s.request(`${url}/script`)).status).toBe(404);
  const manifest = ProjectManifest.parse(await (await s.request(base)).json());
  expect(manifest.pages.find((p) => p.id === page.id)?.episodeId).toBeNull();
  await s.app
    .get(ProjectScriptDatabase)
    .use(project.rootPath, project.id, (db) =>
      expect(db.prepare('SELECT deleted_at FROM episodes WHERE id=?').get(episode.id)).toBeTruthy(),
    );
  await s.restart();
  expect(ProjectManifest.parse(await (await s.request(base)).json()).pages[0].episodeId).toBeNull();
  const database = s.app.get(ProjectScriptDatabase);
  await database.use(project.rootPath, project.id, (db) => {
    db.prepare('UPDATE episodes SET deleted_at=? WHERE id=?').run(
      '2020-01-01T00:00:00.000Z',
      episode.id,
    );
  });
  const next = EpisodeSummary.parse(
    await (await s.request(`${base}/episodes`, 'POST', { number: 2, title: '' })).json(),
  );
  await s.request(`${base}/episodes/${next.id}`, 'DELETE');
  await database.use(project.rootPath, project.id, (db) => {
    expect(db.prepare('SELECT id FROM episodes WHERE id=?').get(episode.id)).toBeUndefined();
    expect(db.prepare('SELECT id FROM episodes WHERE id=?').get(next.id)).toBeTruthy();
  });
});
it('E02/E06 跨项目页面归属和跨集复用内部身份拒绝，原集不受影响', async () => {
  const { s, base, episode, url, doc, read } = await setup();
  await s.request(`${url}/script`, 'PUT', { revision: 1, document: doc });
  const second = EpisodeSummary.parse(
    await (await s.request(`${base}/episodes`, 'POST', { number: 2, title: '' })).json(),
  );
  expect(
    (await s.request(`${base}/episodes/${second.id}/script`, 'PUT', { revision: 1, document: doc }))
      .status,
  ).toBe(409);
  expect((await read()).document.scenes.map((scene) => scene.id)).toEqual(
    doc.scenes.map((scene) => scene.id),
  );
  const other = ProjectSummary.parse(
    await (
      await s.request('/projects', 'POST', { name: '另一项目', location: s.directory })
    ).json(),
  );
  expect(
    (
      await s.request(`/projects/${other.id}/pages`, 'POST', {
        name: '无效跨项目归属',
        episodeId: episode.id,
      })
    ).status,
  ).toBe(404);
  expect((await s.request(`${base}/episodes/${second.id}/script`)).status).toBe(200);
});
