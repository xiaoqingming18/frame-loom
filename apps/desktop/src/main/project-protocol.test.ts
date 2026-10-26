import { afterEach, expect, it, vi } from 'vitest';
import { projectFileRoute, serveProjectFile } from './project-protocol.js';
import { APP_ORIGIN } from './security.js';

const id = '00000000-0000-4000-8000-000000000001';
const hash = 'a'.repeat(64);
const connection = () => Promise.resolve({ baseUrl: 'http://127.0.0.1:4567', token: 'test' });
afterEach(() => vi.unstubAllGlobals());
it.each([
  'bad',
  `frame-project://${id}/assets/../secret`,
  `frame-project://${id}/assets/%2e%2e%2fsecret`,
  `frame-project://${id}/assets/.frameloom/project.json`,
  `frame-project://user@${id}/media/${hash}`,
  `frame-project://${id}/assets/%zz`,
  `frame-project://${id}/media/${hash}?token=x`,
  `frame-project://${id}/assets/%5csecret`,
])('拒绝非法原始 URL：%s', async (url) => {
  expect(projectFileRoute(url)).toBeUndefined();
  expect(
    (await serveProjectFile({ url, method: 'GET', headers: new Headers() } as Request, connection))
      .status,
  ).toBe(403);
});
it('编码资产路径并透传 Range、状态和响应头，只有可信 CORS 源', async () => {
  const fetcher = vi.fn().mockResolvedValue(
    new Response('abc', {
      status: 206,
      headers: {
        'content-range': 'bytes 0-2/10',
        'accept-ranges': 'bytes',
        'content-length': '3',
        'content-type': 'image/png',
        'access-control-allow-origin': '*',
      },
    }),
  );
  vi.stubGlobal('fetch', fetcher);
  const response = await serveProjectFile(
    new Request(`frame-project://${id}/assets/${encodeURIComponent('角色/图片.png')}`, {
      headers: { range: 'bytes=0-2', origin: APP_ORIGIN },
    }),
    connection,
  );
  expect(response.status).toBe(206);
  expect(response.headers.get('content-range')).toBe('bytes 0-2/10');
  expect(response.headers.get('access-control-allow-origin')).toBe(APP_ORIGIN);
  expect(await response.text()).toBe('abc');
  const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];
  expect(url).toBe(
    `http://127.0.0.1:4567/projects/${id}/files/assets?path=${encodeURIComponent('角色/图片.png')}`,
  );
  expect(new Headers(init.headers).get('Authorization')).toBe('Bearer test');
  expect(new Headers(init.headers).get('Range')).toBe('bytes=0-2');
  expect(init.redirect).toBe('error');
  const rejected = await serveProjectFile(
    new Request(`frame-project://${id}/media/${hash}`, {
      headers: { origin: 'https://evil.test' },
    }),
    connection,
  );
  expect(rejected.status).toBe(403);
  expect(rejected.headers.has('access-control-allow-origin')).toBe(false);
  expect(fetcher).toHaveBeenCalledOnce();
});
it('HEAD 不返回正文，engine 不可用返回 502', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response(null, { headers: { 'content-length': '9' } })),
  );
  const response = await serveProjectFile(
    new Request(`frame-project://${id}/media/${hash}`, { method: 'HEAD' }),
    connection,
  );
  expect(response.body).toBeNull();
  expect(response.headers.get('content-length')).toBe('9');
  expect(
    (
      await serveProjectFile(new Request(`frame-project://${id}/media/${hash}`), () =>
        Promise.reject(new Error('offline')),
      )
    ).status,
  ).toBe(502);
});
