import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { ProjectManifest } from '@frame-loom/contracts';
import Database from 'better-sqlite3';
import { afterEach, expect, it, vi } from 'vitest';
import { LocalProjectStore } from './local-project-store.js';
import { ProjectScriptDatabase } from './project-script-database.js';

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});
async function setup() {
  const root = await fs.mkdtemp(join(tmpdir(), 'loom-upgrade-'));
  roots.push(root);
  const now = new Date().toISOString();
  const manifest = ProjectManifest.parse({
    format: 'frame-loom-project',
    formatVersion: 1,
    id: randomUUID(),
    name: '保留项目',
    createdAt: now,
    updatedAt: now,
    profile: { form: null, medium: null, genres: ['都市'], aspect: null },
    episodes: [
      {
        id: randomUUID(),
        number: 1,
        title: '旧集',
        createdAt: now,
        updatedAt: now,
        scenes: 1,
        chars: 2,
        draft: false,
      },
    ],
    pages: [
      {
        id: randomUUID(),
        name: '画布',
        createdAt: now,
        updatedAt: now,
        coverSha256: null,
        episodeId: randomUUID(),
      },
    ],
  });
  const files = [
    '.frameloom/scripts/invalid.json',
    '.frameloom/story.json',
    '.frameloom/trash/scripts/old.json',
    '.frameloom/pages/page.json',
    '.frameloom/media/movie.mp4',
    '.frameloom/trash/pages/page.json',
    '.frameloom/trash/media/old.mp4',
    '.frameloom/tmp/unknown.json',
    '资产/片段.mp4',
  ];
  for (const file of files) {
    await fs.mkdir(join(root, file, '..'), { recursive: true });
    await fs.writeFile(join(root, file), `不可解析哨兵:${file}`);
  }
  await fs.writeFile(join(root, '.frameloom/project.json'), JSON.stringify(manifest));
  const store = new LocalProjectStore();
  const database = new ProjectScriptDatabase();
  return {
    root,
    manifest,
    files,
    store,
    database,
    write: (value: ProjectManifest) => store.writeManifest(root, value),
  };
}
async function hash(root: string, file: string) {
  return createHash('sha256')
    .update(await fs.readFile(join(root, file)))
    .digest('hex');
}
it('P02/P03 限定旧域清除、保留哨兵哈希，新数据重开不二次清理', async () => {
  const { root, manifest, files, database, store, write } = await setup();
  const kept = files.slice(3);
  const before = await Promise.all(kept.map((file) => hash(root, file)));
  const upgraded = await database.prepare(root, manifest, write);
  expect(upgraded).toEqual({
    ...manifest,
    episodes: undefined,
    formatVersion: 2,
    tags: undefined,
    pages: manifest.pages.map((page) => ({ ...page, episodeId: null })),
  });
  for (const file of files.slice(0, 3))
    await expect(fs.stat(join(root, file))).rejects.toMatchObject({ code: 'ENOENT' });
  expect(await Promise.all(kept.map((file) => hash(root, file)))).toEqual(before);
  await database.use(root, manifest.id, (db) =>
    db
      .prepare(
        "INSERT INTO episodes(id,number,title,created_at,updated_at) VALUES (?,1,'新集','','')",
      )
      .run(randomUUID()),
  );
  for (let n = 0; n < 2; n++) await database.prepare(root, await store.readManifest(root), write);
  expect(
    await database.use(root, manifest.id, (db) => db.prepare('SELECT title FROM episodes').get()),
  ).toEqual({ title: '新集' });
});
it.each(['scripts', 'story.json', 'trash/scripts'])(
  'P05 清理 %s 失败不开放写入，重启续做',
  async (path) => {
    const { root, manifest, database, store, write } = await setup();
    const remove = fs.rm;
    vi.spyOn(fs, 'rm').mockImplementation(async (target, options) => {
      if (target === join(root, '.frameloom', path))
        throw Object.assign(new Error('模拟占用'), { code: 'EBUSY' });
      return remove(target, options);
    });
    await expect(database.prepare(root, manifest, write)).rejects.toThrow('模拟占用');
    await expect(database.use(root, manifest.id, () => null)).rejects.toMatchObject({
      code: 'PROJECT_UPGRADING',
    });
    vi.restoreAllMocks();
    expect(
      (await new ProjectScriptDatabase().prepare(root, await store.readManifest(root), write))
        .formatVersion,
    ).toBe(2);
  },
);
it('P05 清单写入失败可恢复，v2 清单缺库不得回到清理', async () => {
  const { root, manifest, database, store, write } = await setup();
  await expect(
    database.prepare(root, manifest, () => Promise.reject(new Error('清单失败'))),
  ).rejects.toThrow('清单失败');
  expect((await store.readManifest(root)).formatVersion).toBe(1);
  await database.prepare(root, await store.readManifest(root), write);
  await fs.rm(join(root, '.frameloom/project.sqlite'));
  await expect(database.prepare(root, await store.readManifest(root), write)).rejects.toMatchObject(
    { code: 'PROJECT_DATABASE_UNAVAILABLE' },
  );
});
it.each(['pending', 'scripts-cleared', 'story-cleared', 'recycle-cleared', 'manifest-written'])(
  'P04 进程在 %s 落盘后退出可继续',
  async (phase) => {
    const { root, manifest, database, store, write } = await setup();
    await database.create(root, manifest.id, 'pending');
    const phases = [
      'pending',
      'scripts-cleared',
      'story-cleared',
      'recycle-cleared',
      'manifest-written',
    ];
    const step = phases.indexOf(phase);
    for (const [index, path] of ['scripts', 'story.json', 'trash/scripts'].entries())
      if (step > index)
        await fs.rm(join(root, '.frameloom', path), { recursive: true, force: true });
    if (phase === 'manifest-written') {
      await write({
        ...manifest,
        episodes: undefined,
        formatVersion: 2,
        pages: manifest.pages.map((page) => ({ ...page, episodeId: null })),
      });
    }
    const db = new Database(join(root, '.frameloom/project.sqlite'));
    db.prepare('UPDATE script_store_meta SET phase=?').run(phase);
    db.close();
    const result = await new ProjectScriptDatabase().prepare(
      root,
      await store.readManifest(root),
      write,
    );
    expect(result.formatVersion).toBe(2);
    for (const path of ['scripts', 'story.json', 'trash/scripts'])
      await expect(fs.stat(join(root, '.frameloom', path))).rejects.toMatchObject({
        code: 'ENOENT',
      });
  },
);
it('P10 拒绝 junction，不碰链接外哨兵', async () => {
  const { root, manifest, database, write } = await setup();
  const outside = await fs.mkdtemp(join(tmpdir(), 'loom-outside-'));
  roots.push(outside);
  await fs.writeFile(join(outside, 'sentinel'), '保留');
  const scripts = join(root, '.frameloom/scripts');
  await fs.rm(scripts, { recursive: true });
  await fs.symlink(outside, scripts, 'junction');
  await expect(database.prepare(root, manifest, write)).rejects.toMatchObject({
    code: 'PROJECT_PATH_UNSAFE',
  });
  expect(await fs.readFile(join(outside, 'sentinel'), 'utf8')).toBe('保留');
  await fs.unlink(scripts);
});
