import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { EngineClient } from '@/lib/engine-client';
import { ObjectStorageSettings } from './object-storage-settings';

const config = {
  endpoint: 'https://s3.example.com/',
  region: 'auto',
  bucket: 'frame-loom',
  accessKeyId: 'access-key',
  forcePathStyle: true,
  keyPrefix: 'frame-loom',
  presignTtlSeconds: 86_400,
  hasSecret: true,
  secretNeedsUpdate: false,
};

afterEach(cleanup);

it('保存时留空保留已存 Secret，展示四步测试结果，移除二次确认后复位', async () => {
  const calls: { path: string; method?: string; body?: unknown }[] = [];
  let stored: typeof config | null = config;
  const client: EngineClient = {
    request(path, schema, init) {
      calls.push({ path, method: init?.method, body: init?.body });
      let value: unknown = stored;
      if (path === '/object-storage/test')
        value = {
          ok: true,
          steps: { upload: true, sign: true, download: true, delete: true },
          message: '连接成功',
        };
      if (path === '/object-storage' && init?.method === 'DELETE') stored = null;
      return Promise.resolve(schema.parse(value));
    },
    async *stream() {},
  };
  const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queries}>
      <ObjectStorageSettings client={client} />
    </QueryClientProvider>,
  );

  await screen.findByRole('textbox', { name: '素材前缀' });
  fireEvent.click(screen.getByRole('button', { name: '保存存储配置' }));
  await screen.findByText('配置已保存');
  expect(calls.find((call) => call.method === 'PUT')?.body).toMatchObject({
    accessKeyId: 'access-key',
  });
  expect(
    (calls.find((call) => call.method === 'PUT')?.body as { secretAccessKey?: string })
      ?.secretAccessKey,
  ).toBeUndefined();

  fireEvent.click(screen.getByRole('button', { name: '测试连接' }));
  await screen.findByText('连接成功');
  expect(screen.getByText(/无凭据下载比对 ✓/)).toBeTruthy();

  fireEvent.click(screen.getByRole('button', { name: '移除配置' }));
  fireEvent.click(screen.getByRole('button', { name: '确认移除配置（保留远端素材）' }));
  await waitFor(() => expect(calls.filter((call) => call.method === 'DELETE')).toHaveLength(1));
  await waitFor(() => expect(screen.queryByRole('button', { name: '移除配置' })).toBeNull());
  queries.clear();
});
