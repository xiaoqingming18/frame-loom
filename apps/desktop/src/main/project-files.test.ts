import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { projectTarget } from './project-files.js';

const id = '00000000-0000-4000-8000-000000000001';
const connection = { baseUrl: 'http://127.0.0.1:4567', token: 'test' };
let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'frame-project-target-'));
  await mkdir(join(root, '.frameloom'));
  const now = new Date().toISOString();
  await writeFile(
    join(root, '.frameloom/project.json'),
    JSON.stringify({
      format: 'frame-loom-project',
      formatVersion: 1,
      id,
      name: '项目',
      pages: [],
      createdAt: now,
      updatedAt: now,
    }),
  );
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify([
            {
              id,
              name: '项目',
              rootPath: root,
              locationKind: 'local',
              remoteId: null,
              createdAt: now,
              updatedAt: now,
              addedAt: now,
              lastOpenedAt: now,
              status: 'available',
            },
          ]),
        ),
      ),
    ),
  );
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await rm(root, { force: true, recursive: true });
});
it('仅从注册表获取根目录，核对磁盘 id，并拒绝内部路径与空资产路径', async () => {
  expect(await projectTarget({ projectId: id }, connection)).toBe(root);
  await writeFile(join(root, 'asset.txt'), 'asset');
  expect(await projectTarget({ projectId: id, path: 'asset.txt' }, connection)).toBe(
    join(root, 'asset.txt'),
  );
  for (const path of ['', '.frameloom', '../secret', 'D:/secret', '.frameloom/project.json'])
    await expect(projectTarget({ projectId: id, path }, connection)).rejects.toThrow();
  await writeFile(join(root, '.frameloom/project.json'), '{}');
  await expect(projectTarget({ projectId: id }, connection)).rejects.toThrow();
});
it('清单 id 不匹配与资产 junction 都拒绝', async () => {
  await mkdir(join(root, 'outside'));
  await symlink(join(root, 'outside'), join(root, 'linked'), 'junction');
  await expect(projectTarget({ projectId: id, path: 'linked' }, connection)).rejects.toThrow(
    'junction',
  );
  const now = new Date().toISOString();
  await writeFile(
    join(root, '.frameloom/project.json'),
    JSON.stringify({
      format: 'frame-loom-project',
      formatVersion: 1,
      id: '00000000-0000-4000-8000-000000000002',
      name: '项目',
      pages: [],
      createdAt: now,
      updatedAt: now,
    }),
  );
  await expect(projectTarget({ projectId: id }, connection)).rejects.toThrow('id 不匹配');
});
