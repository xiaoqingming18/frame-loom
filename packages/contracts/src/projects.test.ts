import { describe, expect, it } from 'vitest';
import {
  AssetPath,
  AssetEntry,
  AssetSearchResult,
  AssetMoveRequest,
  DesktopPreferences,
  DesktopPreferencesUpdate,
  SemanticRequest,
  ProjectManifest,
  ProjectPageFile,
  ProjectPageSaveResult,
  ProjectName,
  ProjectTrashRequest,
  ProjectTag,
  ProjectTagCreateRequest,
  ProjectTagUpdateRequest,
  ProjectTagDeleteRequest,
  BUILTIN_TAGS,
  projectTags,
  emptyCanvasDocument,
  validateEntryName,
} from './index.js';

const randomUUID = () => '123e4567-e89b-42d3-a456-426614174000';

it('项目标签校验名称、颜色、唯一性、数量和请求边界', () => {
  const tag = { id: 'custom-tag', name: ' 测试标签 ', color: 'cyan', builtin: false };
  expect(ProjectTag.parse(tag).name).toBe('测试标签');
  expect(ProjectTag.safeParse({ ...tag, name: '😀'.repeat(11) }).success).toBe(false);
  expect(ProjectTagCreateRequest.safeParse({ name: 'x'.repeat(10), color: 'red' }).success).toBe(
    true,
  );
  expect(ProjectTagCreateRequest.safeParse({ name: 'x'.repeat(11), color: 'red' }).success).toBe(
    false,
  );
  expect(ProjectTagUpdateRequest.safeParse({}).success).toBe(false);
  expect(
    ProjectTagDeleteRequest.safeParse({
      reassign: Array(2001).fill({ pageId: randomUUID(), nodeId: 'n', tagId: null }),
    }).success,
  ).toBe(false);
  expect(BUILTIN_TAGS).toHaveLength(7);
  const manifest = {
    format: 'frame-loom-project',
    formatVersion: 1,
    id: randomUUID(),
    name: '项目',
    createdAt: '2026-10-27T00:00:00Z',
    updatedAt: '2026-10-27T00:00:00Z',
    pages: [],
  };
  expect(projectTags(ProjectManifest.parse(manifest))).toEqual(BUILTIN_TAGS);
  expect(projectTags(ProjectManifest.parse({ ...manifest, tags: [] }))).toEqual([]);
  expect(
    ProjectManifest.safeParse({
      ...manifest,
      tags: [
        { ...tag, name: 'Tag' },
        { ...tag, id: 'different', name: 'tag' },
      ],
    }).success,
  ).toBe(false);
  expect(
    ProjectManifest.safeParse({
      ...manifest,
      tags: Array.from({ length: 51 }, (_, i) => ({ ...tag, id: `tag-${i}`, name: `t${i}` })),
    }).success,
  ).toBe(false);
});

it('资产条目校验大小和类型，搜索必须明确是否截断，移动可指向根目录', () => {
  expect(ProjectPageSaveResult.parse({ revision: 2, missing: ['a'.repeat(64)] }).missing).toEqual([
    'a'.repeat(64),
  ]);
  const entry = {
    name: '镜头.png',
    path: '图片/镜头.png',
    type: 'file',
    bytes: 128,
    updatedAt: '2026-10-26T00:00:00.000Z',
    mediaKind: 'image',
  };
  expect(AssetEntry.parse(entry)).toEqual(entry);
  expect(AssetEntry.safeParse({ ...entry, bytes: -1 }).success).toBe(false);
  expect(AssetEntry.safeParse({ ...entry, mediaKind: 'html' }).success).toBe(false);
  expect(AssetSearchResult.parse({ entries: [entry], truncated: true }).truncated).toBe(true);
  expect(AssetSearchResult.safeParse({ entries: [entry] }).success).toBe(false);
  expect(AssetMoveRequest.parse({ path: entry.path, destination: '' }).destination).toBe('');
  expect(AssetMoveRequest.safeParse({ path: entry.path, destination: '../外部' }).success).toBe(
    false,
  );
});

describe('名称与资产路径', () => {
  it.each([
    '',
    ' ',
    'x'.repeat(81),
    ...'<>:"/\\|?*',
    '\0',
    '\n',
    '\u007f',
    '名称.',
    '名称 ',
    'CON',
    'com1.txt',
    'LPT9.png',
  ])('拒绝名称 %j', (name) => {
    expect(validateEntryName(name)).toEqual(expect.any(String));
  });
  it.each(['项目', 'x', 'x'.repeat(80), '😀'.repeat(80), 'com10.txt', 'console'])(
    '接受名称 %j',
    (name) => {
      expect(validateEntryName(name)).toBeNull();
    },
  );
  it('表单名称去空白，资产路径不正规化', () => {
    expect(ProjectName.parse(' 项目 ')).toBe('项目');
    expect(AssetPath.parse('角色/张三.png')).toBe('角色/张三.png');
  });
  it.each([
    '',
    '../x',
    'x/../y',
    './x',
    'C:/x',
    '/x',
    'x\\y',
    'x\0',
    '.frameloom/x',
    '.FRAMELOOM-backup/x',
    'x/CON.txt',
    'x//y',
    'x/',
    'x/y.',
  ])('拒绝路径 %j', (path) => {
    expect(AssetPath.safeParse(path).success).toBe(false);
  });
});

it('项目与页面保留未知字段，校验必填、重复页面与过高版本', () => {
  const now = new Date().toISOString();
  const page = {
    id: randomUUID(),
    name: '第一集',
    createdAt: now,
    updatedAt: now,
    coverSha256: null,
  };
  const manifest = {
    format: 'frame-loom-project',
    formatVersion: 1,
    id: randomUUID(),
    name: '项目',
    createdAt: now,
    updatedAt: now,
    pages: [page],
    sync: { clock: 3 },
  };
  expect(ProjectManifest.parse(JSON.parse(JSON.stringify(manifest)))).toEqual(manifest);
  expect(ProjectManifest.safeParse({ ...manifest, name: undefined }).success).toBe(false);
  expect(ProjectManifest.safeParse({ ...manifest, pages: [page, page] }).success).toBe(false);
  const tooNew = ProjectManifest.safeParse({ ...manifest, formatVersion: 2 });
  expect(tooNew.success).toBe(false);
  if (!tooNew.success) expect(tooNew.error.message).toContain('PROJECT_FORMAT_TOO_NEW');
  const file = {
    format: 'frame-loom-page',
    formatVersion: 1,
    id: page.id,
    revision: 1,
    document: emptyCanvasDocument(),
    sync: '原样保留',
  };
  expect(ProjectPageFile.parse(file)).toEqual(file);
  expect(ProjectPageFile.safeParse({ ...file, formatVersion: 2 }).success).toBe(false);
});

it('偏好、IPC 参数与生成请求向后兼容且拒绝无效输入', () => {
  expect(DesktopPreferences.parse({ version: 1, theme: 'system' })).toEqual({
    version: 1,
    theme: 'system',
  });
  expect(DesktopPreferencesUpdate.parse({ projectSort: 'name', assetView: 'grid' })).toEqual({
    projectSort: 'name',
    assetView: 'grid',
  });
  expect(DesktopPreferencesUpdate.safeParse({ theme: 'invalid' }).success).toBe(false);
  expect(
    ProjectTrashRequest.safeParse({ projectId: randomUUID(), path: '.frameloom/project.json' })
      .success,
  ).toBe(false);
  const request = { modelId: randomUUID(), prompt: '测试', inputs: [] };
  expect(SemanticRequest.safeParse(request).success).toBe(true);
  expect(
    SemanticRequest.safeParse({ ...request, projectId: randomUUID(), pageId: randomUUID() })
      .success,
  ).toBe(true);
  expect(SemanticRequest.safeParse({ ...request, projectId: '../x' }).success).toBe(false);
});
