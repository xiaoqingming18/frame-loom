import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import {
  EpisodeSummary,
  ProjectManifest,
  ProjectPageSummary,
  ProjectSummary,
  ScriptResult,
} from '@frame-loom/contracts';
import { testEngine } from '../../testing/test-engine.js';
import { ProjectStore } from '../projects/project-store.js';
import { ProjectMediaService } from '../projects/project-media.service.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
async function setup() {
  const s = await testEngine();
  cleanups.push(() => s.close());
  const profile = { form: 'short', medium: 'live', genres: ['悬疑'], aspect: null };
  const project = ProjectSummary.parse(
    await (
      await s.request('/projects', 'POST', { name: '剧本测试', location: s.directory, profile })
    ).json(),
  );
  const base = `/projects/${project.id}`;
  const episode = EpisodeSummary.parse(
    await (await s.request(`${base}/episodes`, 'POST', { number: 1, title: '重逢' })).json(),
  );
  const url = `${base}/episodes/${episode.id}`;
  return { s, project, profile, episode, base, url };
}

it('读取磁盘 v1 自动迁移且首次保存写出 v2', async () => {
  const { s, project, url, episode } = await setup();
  const path = join(project.rootPath, '.frameloom/scripts', `${episode.id}.json`);
  const original = JSON.parse(await fs.readFile(path, 'utf8')) as Record<string, unknown>;
  await fs.writeFile(
    path,
    JSON.stringify({
      ...original,
      document: {
        schemaVersion: 1,
        blocks: [{ id: 's', type: 'scene', text: '天台', attrs: { time: 'night', space: 'ext' } }],
      },
    }),
  );
  const result = ScriptResult.parse(await (await s.request(`${url}/script`)).json());
  expect(result.document).toMatchObject({
    schemaVersion: 2,
    preface: '',
    appendix: '',
    blocks: [{ attrs: { timeText: null, note: null, timecode: null } }],
  });
  expect(
    (
      await s.request(`${url}/script`, 'PUT', {
        revision: result.revision,
        document: result.document,
      })
    ).status,
  ).toBe(200);
  expect(JSON.parse(await fs.readFile(path, 'utf8')) as unknown).toMatchObject({
    formatVersion: 1,
    document: { schemaVersion: 2 },
  });
});

it('项目设定与页面所属剧集兼容旧目录并校验边界', async () => {
  const { s, project, profile, episode, base } = await setup();
  expect(project.profile).toEqual(profile);
  expect(ProjectManifest.parse(await (await s.request(base)).json()).profile).toEqual(profile);
  expect(((await (await s.request('/projects')).json()) as ProjectSummary[])[0].profile).toEqual(
    profile,
  );
  expect(
    (await s.request(`${base}/profile`, 'PUT', { ...profile, genres: Array(6).fill('悬疑') }))
      .status,
  ).toBe(400);
  expect((await s.request(`${base}/profile`, 'PUT', { ...profile, aspect: '16:9' })).status).toBe(
    200,
  );
  const page = ProjectPageSummary.parse(
    await (
      await s.request(`${base}/pages`, 'POST', { name: '画布', episodeId: episode.id })
    ).json(),
  );
  expect(page.episodeId).toBe(episode.id);
  expect(
    (await s.request(`${base}/pages/${page.id}`, 'PATCH', { episodeId: randomUUID() })).status,
  ).toBe(404);
  expect(
    await (await s.request(`${base}/pages/${page.id}`, 'PATCH', { episodeId: null })).json(),
  ).toMatchObject({ name: '画布', episodeId: null });
  expect(
    (await s.request(`${base}/pages`, 'POST', { name: '错误', episodeId: randomUUID() })).status,
  ).toBe(404);
  await fs.rm(join(project.rootPath, '.frameloom/scripts'), { recursive: true });
  await fs.rm(join(project.rootPath, '.frameloom/trash/scripts'), { recursive: true });
  expect((await s.request(base)).status).toBe(200);
  expect((await s.request(`${base}/pages`, 'POST', { name: '旧项目画布' })).status).toBe(201);
});

it('剧集增改删、集号冲突、删除失败恢复和页面保留', async () => {
  const { s, project, episode, base, url } = await setup();
  expect((await s.request(`${base}/episodes`, 'POST', { number: 1, title: '' })).status).toBe(409);
  expect((await s.request(url, 'PATCH', { number: 3, title: '第三集' })).status).toBe(200);
  await s.request(`${base}/episodes`, 'POST', { number: 2, title: '' });
  expect(
    ((await (await s.request(`${base}/episodes`)).json()) as EpisodeSummary[]).map(
      (item) => item.number,
    ),
  ).toEqual([2, 3]);
  expect(await (await s.request(url, 'PATCH', { number: 2 })).json()).toMatchObject({
    code: 'EPISODE_NUMBER_CONFLICT',
  });
  const page = ProjectPageSummary.parse(
    await (
      await s.request(`${base}/pages`, 'POST', { name: '保留画布', episodeId: episode.id })
    ).json(),
  );
  vi.spyOn(s.app.get(ProjectStore), 'writeManifest').mockRejectedValueOnce(
    new Error('清单写入失败'),
  );
  expect((await s.request(url, 'DELETE')).status).toBe(500);
  expect((await s.request(`${url}/script`)).status).toBe(200);
  expect(await fs.readdir(join(project.rootPath, '.frameloom/trash/scripts'))).toEqual([]);
  expect((await s.request(url, 'DELETE')).status).toBe(200);
  expect(await fs.readdir(join(project.rootPath, '.frameloom/trash/scripts'))).toHaveLength(1);
  expect(
    ProjectManifest.parse(await (await s.request(base)).json()).pages.find(
      (item) => item.id === page.id,
    )?.episodeId,
  ).toBeNull();
  expect((await s.request(`${base}/pages/${page.id}`)).status).toBe(200);
});

it('剧本 revision 与外部修改冲突、摘要修复与落盘顺序', async () => {
  const { s, project, base, url, episode } = await setup();
  const file = ScriptResult.parse(await (await s.request(`${url}/script`)).json());
  expect(file).toMatchObject({
    revision: 1,
    document: { schemaVersion: 2, preface: '', appendix: '', blocks: [] },
  });
  const document = {
    schemaVersion: 1,
    blocks: [
      { id: 'scene', type: 'scene', text: '客厅', attrs: { time: 'day', space: 'int' } },
      { id: 'line', type: 'action', text: '风 吹' },
    ],
  };
  expect(
    await (await s.request(`${url}/script`, 'PUT', { revision: 1, document })).json(),
  ).toMatchObject({ revision: 2 });
  expect(ProjectManifest.parse(await (await s.request(base)).json()).episodes![0]).toMatchObject({
    scenes: 1,
    chars: 4,
    draft: false,
  });
  expect(
    await (await s.request(`${url}/script`, 'PUT', { revision: 1, document })).json(),
  ).toMatchObject({ code: 'SCRIPT_REVISION_CONFLICT' });
  const path = join(project.rootPath, '.frameloom/scripts', `${episode.id}.json`);
  const raw = await fs.readFile(path, 'utf8');
  const info = await fs.stat(path);
  await fs.writeFile(path, raw.replace('风 吹', '雨 落'));
  await fs.utimes(path, info.atime, info.mtime);
  expect(
    await (await s.request(`${url}/script`, 'PUT', { revision: 2, document })).json(),
  ).toMatchObject({ code: 'SCRIPT_REVISION_CONFLICT' });
  await s.request(`${url}/script`);
  vi.spyOn(s.app.get(ProjectStore), 'writeManifest').mockRejectedValueOnce(
    new Error('摘要写入失败'),
  );
  expect(
    (
      await s.request(`${url}/script`, 'PUT', {
        revision: 2,
        document: { schemaVersion: 1, blocks: [] },
      })
    ).status,
  ).toBe(500);
  expect(ScriptResult.parse(await (await s.request(`${url}/script`)).json()).revision).toBe(3);
  expect(ProjectManifest.parse(await (await s.request(base)).json()).episodes![0]).toMatchObject({
    scenes: 0,
    chars: 0,
  });
});

it('剧本回收区按删除时间保留 30 天，旧目录缺失可清理', async () => {
  const { s, project, url } = await setup();
  await s.request(url, 'DELETE');
  const folder = join(project.rootPath, '.frameloom/trash/scripts');
  const name = (await fs.readdir(folder))[0];
  const media = s.app.get(ProjectMediaService);
  await media.cleanupAt(project.id, project.rootPath);
  expect(await fs.readdir(folder)).toEqual([name]);
  const old = new Date(Date.now() - 31 * 86400_000);
  await fs.utimes(join(folder, name), old, old);
  await media.cleanupAt(project.id, project.rootPath);
  expect(await fs.readdir(folder)).toEqual([]);
  await fs.rmdir(folder);
  await expect(media.cleanupAt(project.id, project.rootPath)).resolves.toMatchObject({ files: 0 });
});

it('超过 500 集时拒绝创建', async () => {
  const { s, project, episode, base } = await setup();
  const store = s.app.get(ProjectStore);
  const manifest = await store.readManifest(project.rootPath);
  manifest.episodes = Array.from({ length: 500 }, (_, index) => ({
    ...episode,
    id: randomUUID(),
    number: index + 1,
  }));
  await store.writeManifest(project.rootPath, manifest);
  expect(
    await (await s.request(`${base}/episodes`, 'POST', { number: 501, title: '' })).json(),
  ).toMatchObject({ code: 'EPISODE_LIMIT_EXCEEDED' });
});
