import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { mediaHash, mediaRange, serveMedia } from './media-protocol.js';
import { PRODUCTION_CSP } from './security.js';

it('媒体协议只接受原始哈希，不接受任意路径、凭据、端口、编码和查询', () => {
  const hash = 'a'.repeat(64);
  expect(mediaHash(`frame-media://${hash}`)).toBe(hash);
  expect(mediaHash(`frame-media://${hash}/`)).toBe(hash);
  for (const suffix of ['/../secret', '/%2e%2e', ':80', '?x=1', '#x', '/file.png', '\\secret'])
    expect(mediaHash(`frame-media://${hash}${suffix}`)).toBeUndefined();
  expect(mediaHash(`frame-media://user@${hash}`)).toBeUndefined();
  expect(mediaHash(`frame-media://${'A'.repeat(64)}`)).toBeUndefined();
  expect(PRODUCTION_CSP).toContain("img-src 'self' frame-media:");
  expect(PRODUCTION_CSP).toContain("media-src 'self' frame-media:");
});
it('Range 支持闭合、开放与后缀范围，拒绝多区间和越界', () => {
  expect(mediaRange('bytes=2-4', 10)).toEqual({ start: 2, end: 4 });
  expect(mediaRange('bytes=2-', 10)).toEqual({ start: 2, end: 9 });
  expect(mediaRange('bytes=-3', 10)).toEqual({ start: 7, end: 9 });
  expect(mediaRange('bytes=0-99', 10)).toEqual({ start: 0, end: 9 });
  for (const value of [
    'bytes=10-',
    'bytes=7-3',
    'bytes=-0',
    'bytes=0-1,3-4',
    'bytes=-',
    'bytes=999999999999999999-',
  ])
    expect(() => mediaRange(value, 10)).toThrow();
});
it('只读本地哈希文件，响应正确字节和状态', async () => {
  const root = await mkdtemp(join(tmpdir(), 'loom-media-protocol-'));
  const url = `frame-media://${'a'.repeat(64)}`;
  try {
    await writeFile(join(root, `${'a'.repeat(64)}.png`), '0123456789');
    const full = await serveMedia(root, new Request(url));
    expect(full.status).toBe(200);
    expect(await full.text()).toBe('0123456789');
    const range = await serveMedia(root, new Request(url, { headers: { Range: 'bytes=2-4' } }));
    expect(range.status).toBe(206);
    expect(range.headers.get('content-range')).toBe('bytes 2-4/10');
    expect(await range.text()).toBe('234');
    expect(
      (await serveMedia(root, new Request(url, { method: 'HEAD' }))).headers.get('content-length'),
    ).toBe('10');
    expect(
      (await serveMedia(root, new Request(url, { headers: { Range: 'bytes=100-' } }))).status,
    ).toBe(416);
    expect((await serveMedia(root, new Request(url, { method: 'POST' }))).status).toBe(403);
    expect((await serveMedia(root, new Request(`frame-media://${'b'.repeat(64)}`))).status).toBe(
      404,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
