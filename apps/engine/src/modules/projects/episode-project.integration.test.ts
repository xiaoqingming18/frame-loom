import { afterEach, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import { join } from 'node:path';
import {
  ProjectSummary,
  ProjectManifest,
  EpisodeSummary,
  ScriptResult,
} from '@frame-loom/contracts';
import { testEngine } from '../../testing/test-engine.js';
import { ProjectStore } from './project-store.js';
import { ProjectScriptDatabase } from './project-script-database.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const close of cleanups.splice(0).reverse()) await close();
});
async function setup() {
  const engine = await testEngine();
  cleanups.push(() => engine.close());
  const project = ProjectSummary.parse(
    await (
      await engine.request('/projects', 'POST', { name: '项目原件', location: engine.directory })
    ).json(),
  );
  return { ...engine, engine, project, base: `/projects/${project.id}` };
}
it('P01 创建建库／清单失败不登记，意外新增的用户文件保留', async () => {
  const { engine } = await setup();
  const database = engine.app.get(ProjectScriptDatabase);
  const create = vi.spyOn(database, 'create').mockRejectedValueOnce(new Error('建库失败'));
  expect(
    (await engine.request('/projects', 'POST', { name: '失败建库', location: engine.directory }))
      .status,
  ).toBe(500);
  create.mockRestore();
  const store = engine.app.get(ProjectStore),
    original = store.writeManifest.bind(store);
  vi.spyOn(store, 'writeManifest')
    .mockImplementationOnce(async (root) => {
      await fs.writeFile(join(root, '用户哨兵.txt'), '保留');
      throw new Error('清单失败');
    })
    .mockImplementation(original);
  expect(
    (await engine.request('/projects', 'POST', { name: '失败清单', location: engine.directory }))
      .status,
  ).toBe(500);
  expect(await fs.readFile(join(engine.directory, '失败清单/用户哨兵.txt'), 'utf8')).toBe('保留');
  expect(await (await engine.request('/projects')).json()).toEqual([
    expect.objectContaining({ name: '项目原件' }),
  ]);
});
it('P07/P09 两项目隔离、副本失败回滚身份、移除不删文件、重新登记和定位可继续保存', async () => {
  const { engine, project, base } = await setup();
  const episode = EpisodeSummary.parse(
    await (await engine.request(`${base}/episodes`, 'POST', { number: 1, title: '保留' })).json(),
  );
  const scriptUrl = `${base}/episodes/${episode.id}/script`;
  const record = ScriptResult.parse(await (await engine.request(scriptUrl)).json());
  await engine.request(scriptUrl, 'PUT', { revision: record.revision, document: record.document });
  const copiedRoot = join(engine.directory, '副本目录');
  await fs.cp(project.rootPath, copiedRoot, { recursive: true });
  const store = engine.app.get(ProjectStore);
  const failing = vi.spyOn(store, 'writeManifest').mockRejectedValueOnce(new Error('副本写失败'));
  expect(
    (
      await engine.request('/projects/open', 'POST', {
        rootPath: copiedRoot,
        asCopy: true,
        name: '独立副本',
      })
    ).status,
  ).toBe(500);
  failing.mockRestore();
  await expect(
    engine.app.get(ProjectScriptDatabase).use(copiedRoot, project.id, () => true),
  ).resolves.toBe(true);
  const copy = ProjectSummary.parse(
    await (
      await engine.request('/projects/open', 'POST', {
        rootPath: copiedRoot,
        asCopy: true,
        name: '独立副本',
      })
    ).json(),
  );
  expect(copy.id).not.toBe(project.id);
  expect(
    ScriptResult.parse(
      await (await engine.request(`/projects/${copy.id}/episodes/${episode.id}/script`)).json(),
    ).revision,
  ).toBe(2);
  await engine.request(`/projects/${copy.id}/episodes/${episode.id}`, 'PATCH', {
    title: '独立标题',
  });
  expect(
    ScriptResult.parse(await (await engine.request(scriptUrl)).json()).document.meta.title,
  ).toBe('保留');
  expect((await engine.request(base, 'DELETE')).status).toBe(200);
  await expect(fs.stat(join(project.rootPath, '.frameloom/project.sqlite'))).resolves.toBeTruthy();
  await engine.request('/projects/open', 'POST', { rootPath: project.rootPath });
  const moved = join(engine.directory, '移动原件');
  await fs.rename(project.rootPath, moved);
  expect((await engine.request(`${base}/relocate`, 'POST', { rootPath: moved })).status).toBe(201);
  const after = ScriptResult.parse(await (await engine.request(scriptUrl)).json());
  expect(
    (await engine.request(scriptUrl, 'PUT', { revision: after.revision, document: after.document }))
      .status,
  ).toBe(200);
  expect(ProjectManifest.parse(await (await engine.request(base)).json()).episodes).toHaveLength(1);
});
