import { expect, it, vi } from 'vitest';
import { mockUpstream } from '../../../testing/mock-upstream.js';
import { send } from './http.js';
import type { AdapterContext } from './types.js';
import { openaiImages } from './openai-images.js';

it.each([65_000, 301_000])('HTTP 200 后等待完整图片响应（延迟 %i 毫秒）', async (delay) => {
  vi.useFakeTimers();
  vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(new DOMException('超时', 'TimeoutError')), ms);
    return controller.signal;
  });
  vi.stubGlobal(
    'fetch',
    vi.fn((_url: string, init: RequestInit) => {
      const signal = init.signal!;
      return Promise.resolve(
        new Response(
          new ReadableStream({
            start(controller) {
              const timer = setTimeout(() => {
                controller.enqueue(new TextEncoder().encode('{"data":[]}'));
                controller.close();
              }, delay);
              signal.addEventListener(
                'abort',
                () => {
                  clearTimeout(timer);
                  controller.error(signal.reason);
                },
                { once: true },
              );
            },
          }),
          { status: 200, headers: { 'x-request-id': 'delayed-image' } },
        ),
      );
    }),
  );
  const diagnostics: Parameters<AdapterContext['diagnose']>[0][] = [];
  try {
    const result = send(
      { operation: 'edit', method: 'POST', url: 'http://127.0.0.1/v1/images/edits', headers: {} },
      { signal: new AbortController().signal, diagnose: (value) => diagnostics.push(value) },
      openaiImages.submitTimeoutMs,
    );
    const assertion =
      delay < 300_000
        ? expect(result).resolves.toMatchObject({ status: 200 })
        : expect(result).rejects.toMatchObject({
            category: 'timeout',
            code: 'RESPONSE_TIMEOUT',
          });
    await vi.advanceTimersByTimeAsync(60_001);
    expect(diagnostics.at(-1)).toMatchObject({ httpStatus: 200, requestId: 'delayed-image' });
    await vi.advanceTimersByTimeAsync(240_000);
    await assertion;
    expect(fetch).toHaveBeenCalledTimes(1);
  } finally {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  }
});

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
