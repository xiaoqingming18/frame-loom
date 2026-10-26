import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { EngineClient } from '@/lib/engine-client';
import { AssetBrowser } from './asset-browser';
import { canChooseDirectory } from './asset-utils';
import { CanvasAssetDialog } from './canvas/canvas-asset-dialog';

afterEach(cleanup);
const base = { type: 'file', bytes: 5, updatedAt: '2026-10-27T00:00:00Z' };
const entries = [
  { ...base, name: '图.png', path: '图.png', mediaKind: 'image' },
  { ...base, name: '片.mp4', path: '片.mp4', mediaKind: 'video' },
  { ...base, name: '音.mp3', path: '音.mp3', mediaKind: 'audio' },
  { ...base, name: '文.txt', path: '文.txt', mediaKind: null },
  { ...base, name: '目录', path: '目录', type: 'directory', mediaKind: null },
];
function client() {
  const request = vi
    .fn<EngineClient['request']>()
    .mockImplementation((_path, schema) => Promise.resolve(schema.parse(entries)));
  return {
    request,
    client: {
      request: (path, schema, init) =>
        request(path, schema, init).then((value) => schema.parse(value)),
      stream: vi.fn(),
    } satisfies EngineClient,
  };
}
function mount(node: React.ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{node}</QueryClientProvider>);
}
it('媒体选择器只允许图片视频；图片入口仅允许图片，目录继续可浏览', async () => {
  const api = client();
  const pick = vi.fn();
  const view = mount(
    <AssetBrowser
      client={api.client}
      projectId="project"
      path=""
      onPathChange={vi.fn()}
      mode="media"
      onChoose={pick}
    />,
  );
  fireEvent.click(await screen.findByRole('button', { name: '图.png' }));
  expect(pick).toHaveBeenCalledWith(expect.objectContaining({ path: '图.png' }));
  expect(screen.getByRole('button', { name: '片.mp4' })).toBeDefined();
  expect(screen.queryByRole('button', { name: '音.mp3' })).toBeNull();
  expect(screen.queryByRole('button', { name: '文.txt' })).toBeNull();
  view.unmount();
  mount(
    <AssetBrowser
      client={api.client}
      projectId="project"
      path=""
      onPathChange={vi.fn()}
      mode="image"
    />,
  );
  await screen.findByRole('button', { name: '图.png' });
  expect(screen.queryByRole('button', { name: '片.mp4' })).toBeNull();
});
it('移动不能进入自身或子目录，也不能选择自身，根目录仍可用', async () => {
  const api = client();
  mount(
    <AssetBrowser
      client={api.client}
      projectId="project"
      path=""
      onPathChange={vi.fn()}
      mode="directory"
      excluded="目录"
    />,
  );
  expect((await screen.findByRole<HTMLButtonElement>('button', { name: '目录' })).disabled).toBe(
    true,
  );
  expect(canChooseDirectory('目录/子目录', '目录')).toBe(false);
  expect(canChooseDirectory('', '目录')).toBe(true);
});
it('保存到资产使用默认文件名和所选目标目录', async () => {
  const api = client();
  const close = vi.fn();
  api.request.mockImplementation((path, schema, init) =>
    Promise.resolve(
      schema.parse(init?.method ? entries[0] : path.includes('path=') ? [] : entries),
    ),
  );
  const resolve = vi.fn();
  mount(
    <CanvasAssetDialog
      client={api.client}
      projectId="project"
      request={{
        kind: 'save',
        version: {
          sha256: 'a'.repeat(64),
          mime: 'image/png',
          width: 1,
          height: 1,
          durationMs: null,
          createdAt: base.updatedAt,
        },
        resolve,
      }}
      onClose={close}
    />,
  );
  expect(screen.getByRole<HTMLInputElement>('textbox', { name: '保存资产文件名' }).value).toBe(
    '素材.png',
  );
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(api.request).toHaveBeenCalledWith(
    '/projects/project/assets/from-media',
    expect.anything(),
    expect.objectContaining({ body: { sha256: 'a'.repeat(64), path: '', name: '素材.png' } }),
  );
});
