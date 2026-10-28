import { expect, it } from 'vitest';
import { mockUpstream } from '../../../testing/mock-upstream.js';
import { send } from './http.js';
import type { AdapterContext } from './types.js';

it('诊断只保留路径、状态和脱敏请求 ID，拒绝重定向且不暴露正文', async () => {
  const upstream = await mockUpstream([
    {
      method: 'POST',
      path: '/submit?private=query-secret',
      headers: { authorization: 'Bearer local-secret' },
      reply: () => ({
        status: 401,
        headers: { 'x-request-id': 'id-local-secret' },
        body: 'private-body',
      }),
    },
    {
      method: 'GET',
      path: '/redirect',
      reply: () => ({ status: 302, headers: { Location: '/forbidden' } }),
    },
  ]);
  const diagnostics: Parameters<AdapterContext['diagnose']>[0][] = [];
  const ctx = {
    signal: new AbortController().signal,
    credentials: { apiKey: 'local-secret', secretKey: '', headers: {} },
    diagnose: (diagnostic: Parameters<AdapterContext['diagnose']>[0]) =>
      diagnostics.push(diagnostic),
  };
  try {
    await expect(
      send(
        {
          operation: 'submit',
          method: 'POST',
          url: `${upstream.origin}/submit?private=query-secret`,
          headers: { Authorization: 'Bearer local-secret' },
        },
        ctx,
      ),
    ).rejects.toMatchObject({ category: 'auth' });
    expect(diagnostics.at(-1)).toMatchObject({
      route: '/submit',
      httpStatus: 401,
      requestId: 'id-[已隐藏]',
    });
    expect(JSON.stringify(diagnostics)).not.toMatch(
      /local-secret|query-secret|private-body|Bearer/,
    );
    await expect(
      send(
        { operation: 'query', method: 'GET', url: `${upstream.origin}/redirect`, headers: {} },
        ctx,
      ),
    ).rejects.toThrow();
    expect(upstream.requests).toHaveLength(2);
    expect(upstream.violations).toEqual([]);
  } finally {
    await upstream.close();
  }
});

it('multipart 文件超过 64MB 时不建立连接', async () => {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(64 * 1024 * 1024 + 1)]), 'large.bin');
  await expect(
    send(
      {
        operation: 'submit',
        method: 'POST',
        url: 'http://127.0.0.1:1/unreachable',
        headers: {},
        body: form,
      },
      {
        signal: new AbortController().signal,
        diagnose: () => {
          throw new Error('不应发送');
        },
      },
    ),
  ).rejects.toMatchObject({ code: 'REQUEST_TOO_LARGE' });
});

it('multipart 编码后发送正确边界与文件', async () => {
  const upstream = await mockUpstream([
    {
      method: 'POST',
      path: '/multipart',
      reply: (req) => {
        expect(req.headers['content-type']).toMatch(/^multipart\/form-data; boundary=/);
        expect(req.body).toContain('filename="sample.txt"');
        expect(req.body).toContain('sample-content');
        return { body: '{}' };
      },
    },
  ]);
  try {
    const body = new FormData();
    body.append('file', new Blob(['sample-content']), 'sample.txt');
    await send(
      {
        operation: 'submit',
        method: 'POST',
        url: `${upstream.origin}/multipart`,
        headers: {},
        body,
      },
      { signal: new AbortController().signal, diagnose: () => {} },
    );
    expect(upstream.violations).toEqual([]);
  } finally {
    await upstream.close();
  }
});
