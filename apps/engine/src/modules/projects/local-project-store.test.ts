import { BUILTIN_TAGS } from '@frame-loom/contracts';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { LocalProjectStore } from './local-project-store.js';

const directories: string[] = [];
afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const directory of directories.splice(0))
    await fs.rm(directory, { recursive: true, force: true });
});

async function setup() {
  const root = await fs.mkdtemp(join(tmpdir(), 'loom-store-'));
  directories.push(root);
  await fs.mkdir(join(root, '.frameloom/tmp'), { recursive: true });
  const target = join(root, '.frameloom/project.json');
  await fs.writeFile(target, '原始内容');
  return { root, target, store: new LocalProjectStore() };
}

it('剧本文件被占用时复用原子写重试，保留未知字段并检测外部修改', async () => {
  const { root, store } = await setup();
  const file = {
    format: 'frame-loom-script' as const,
    formatVersion: 1 as const,
    id: randomUUID(),
    revision: 1,
    source: null,
    pendingImport: null,
    convertedAt: null,
    document: { schemaVersion: 2 as const, preface: '', appendix: '', blocks: [] },
    unknown: '保留',
  };
  expect(await store.readStory(root)).toMatchObject({ revision: 0, elements: [], ignored: [] });
  const rename = fs.rename;
  const spy = vi
    .spyOn(fs, 'rename')
    .mockRejectedValueOnce(Object.assign(new Error('占用'), { code: 'EBUSY' }))
    .mockImplementation(rename);
  await store.writeScript(root, file);
  expect(spy).toHaveBeenCalledTimes(2);
  expect(await store.readScript(root, file.id)).toEqual(file);
  const path = join(root, '.frameloom/scripts', `${file.id}.json`);
  await fs.writeFile(path, JSON.stringify({ ...file, unknown: '改动' }));
  await expect(store.readScript(root, file.id, true)).rejects.toMatchObject({
    code: 'SCRIPT_REVISION_CONFLICT',
  });
});

it.each([
  { name: '旧清单普通写入补齐默认标签', tags: undefined, expected: BUILTIN_TAGS },
  { name: '普通写入保留显式空标签，不恢复默认标签', tags: [], expected: [] },
])('$name', async ({ tags, expected }) => {
  const { root, target, store } = await setup();
  const original = JSON.stringify({
    format: 'frame-loom-project',
    formatVersion: 1,
    id: '00000000-0000-4000-8000-000000000001',
    name: '原项目',
    createdAt: '2026-10-27T00:00:00.000Z',
    updatedAt: '2026-10-27T00:00:00.000Z',
    pages: [],
    tags,
  });
  await fs.writeFile(target, original);
  const manifest = await store.readManifest(root);
  expect(manifest.tags).toEqual(tags);
  expect(await fs.readFile(target, 'utf8')).toBe(original);

  manifest.name = '已重命名';
  await store.writeManifest(root, manifest);

  expect(JSON.parse(await fs.readFile(target, 'utf8'))).toEqual({
    ...manifest,
    tags: expected,
  });
  expect((await store.readManifest(root)).tags).toEqual(expected);
});

it('文件被占用后重试，释放时原子替换，临时文件清理', async () => {
  const { root, target, store } = await setup();
  const rename = fs.rename;
  const spy = vi
    .spyOn(fs, 'rename')
    .mockRejectedValueOnce(Object.assign(new Error('占用'), { code: 'EBUSY' }))
    .mockImplementation(rename);
  await store.atomicWrite(root, 'project.json', { saved: true });
  expect(spy).toHaveBeenCalledTimes(2);
  expect(JSON.parse(await fs.readFile(target, 'utf8'))).toEqual({ saved: true });
  expect(await fs.readdir(join(root, '.frameloom/tmp'))).toEqual([]);
});

it('持续占用 2 秒后报错，原文件不变且不遗留临时文件', async () => {
  const { root, target, store } = await setup();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.spyOn(fs, 'rename').mockRejectedValue(Object.assign(new Error('占用'), { code: 'EPERM' }));
  await expect(store.atomicWrite(root, 'project.json', { changed: true })).rejects.toMatchObject({
    code: 'PROJECT_WRITE_FAILED',
  });
  expect(await fs.readFile(target, 'utf8')).toBe('原始内容');
  expect(await fs.readdir(join(root, '.frameloom/tmp'))).toEqual([]);
});

it('按项目串行，失败后继续队列，其他项目不等待', async () => {
  const store = new LocalProjectStore();
  const order: number[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const first = store
    .serial('one', async () => {
      order.push(1);
      await gate;
      throw new Error('失败');
    })
    .catch(() => {});
  const next = store.serial('one', () => {
    order.push(3);
  });
  await store.serial('two', () => {
    order.push(2);
  });
  expect(order).toEqual([1, 2]);
  release();
  await Promise.all([first, next]);
  expect(order).toEqual([1, 2, 3]);
});

it('内部目录被替换成 junction 时拒绝读取与写入', async () => {
  const { root, store } = await setup();
  const outside = await fs.mkdtemp(join(tmpdir(), 'loom-outside-'));
  directories.push(outside);
  await fs.rm(join(root, '.frameloom'), { recursive: true });
  await fs.symlink(
    outside,
    join(root, '.frameloom'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  await expect(store.readManifest(root)).rejects.toMatchObject({ code: 'PROJECT_PATH_UNSAFE' });
  await expect(store.atomicWrite(root, 'project.json', {})).rejects.toMatchObject({
    code: 'PROJECT_PATH_UNSAFE',
  });
  expect(await fs.readdir(outside)).toEqual([]);
});

it('登记后的根目录被替换为 junction 时也拒绝访问', async () => {
  const { root, store } = await setup();
  const moved = `${root}-moved`;
  directories.push(moved);
  await fs.rename(root, moved);
  await fs.symlink(moved, root, process.platform === 'win32' ? 'junction' : 'dir');
  await expect(store.readManifest(root)).rejects.toMatchObject({ code: 'PROJECT_PATH_UNSAFE' });
});
