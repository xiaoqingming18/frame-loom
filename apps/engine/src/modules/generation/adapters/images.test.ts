import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { checkGenerationRequest, GenerationRequest } from '@frame-loom/contracts';
import { openaiImages } from './openai-images.js';
import { arkImages } from './ark-images.js';
import { geminiImage } from './gemini-image.js';
import { imageProfiles, imageProfile } from '../profiles/image-profiles.js';
import { mediaProfile } from '../profiles/media-profiles.js';

let server: Server;
let baseUrl: string;
let status = 200;
let code = '';
let responseBody: unknown;
const requests: {
  url: string;
  body: string;
  contentType?: string;
  auth?: string;
  geminiKey?: string;
}[] = [];
beforeAll(async () => {
  server = createServer((req, res) => {
    if (
      req.method !== 'POST' ||
      !(
        /^\/images\/(generations|edits)$/.test(req.url ?? '') ||
        /^\/models\/[^/]+:generateContent$/.test(req.url ?? '')
      )
    ) {
      res.writeHead(404).end();
      return;
    }
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      requests.push({
        url: req.url!,
        body: Buffer.concat(chunks).toString(),
        contentType: req.headers['content-type'],
        auth: req.headers.authorization,
        geminiKey: req.headers['x-goog-api-key'] as string | undefined,
      });
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify(
          status === 200 ? responseBody : { error: { code, message: '不应透传的密钥 sk-private' } },
        ),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

it('图片档案白名单拒绝模型族不支持的比例、清晰度、画质和旧供应商参数', () => {
  for (const [protocol, upstreamModelId, params] of [
    ['openai-images', 'gpt-image-1', { aspectRatio: '16:9' }],
    ['openai-images', 'gpt-image-1', { resolution: '2K' }],
    ['openai-images', 'gpt-image-2', { quality: 'max' }],
    ['openai-images', 'gpt-image-2.5', { size: '1024x1024', n: 4 }],
    ['gemini-image', 'gemini-2.5-flash-image', { resolution: '4K' }],
    ['gemini-image', 'gemini-3.1-flash-image', { aspectRatio: '1:8' }],
    ['gemini-image', 'gemini-3-pro-image', { background: 'transparent' }],
    ['ark-images', 'doubao-seedream-4-5', { resolution: '1K' }],
    ['ark-images', 'doubao-seedream-4-0', { quality: 'high' }],
  ] as const) {
    const profile = mediaProfile({ kind: 'image', protocol, upstreamModelId, profileId: null });
    expect(
      checkGenerationRequest(
        profile,
        GenerationRequest.parse({
          modelId: '11111111-1111-4111-8111-111111111111',
          mode: 'text',
          prompt: '测试',
          params,
        }),
      ),
    ).not.toHaveLength(0);
  }
  const gpt2 = imageProfile({
    kind: 'image',
    protocol: 'openai-images',
    upstreamModelId: 'gpt-image-2',
    profileId: null,
  });
  expect(gpt2.params.find((param) => param.key === 'resolution')?.notes).toEqual({ '4K': '实验' });
  expect(gpt2.params.find((param) => param.key === 'background')?.notes).toEqual({
    transparent: '预览',
  });
});

for (const adapter of [openaiImages, arkImages, geminiImage]) {
  it(`${adapter.protocol}：样例解析、鉴权、参考图映射与安全错误分类`, async () => {
    responseBody = JSON.parse(
      readFileSync(new URL(`./fixtures/${adapter.protocol}.json`, import.meta.url), 'utf8'),
    ) as unknown;
    const request = GenerationRequest.parse({
      modelId: '11111111-1111-4111-8111-111111111111',
      prompt: '测试',
      mode: 'text',
      params: {},
    });
    const context = {
      baseUrl,
      apiKey: 'sk-private',
      headers: {},
      model: 'example-model',
      signal: AbortSignal.timeout(10_000),
    };
    status = 200;
    const result = await adapter.submit(context, request);
    expect(result.status).toBe('succeeded');
    if (result.status === 'succeeded') expect(result.outputs).toHaveLength(1);
    await expect(
      adapter.submit({ ...context, connection: { routes: { submit: 'wrong' } } }, request),
    ).rejects.toMatchObject({ code: 'HTTP_404' });
    expect(requests.at(-1)).toMatchObject(
      adapter.protocol === 'gemini-image'
        ? { geminiKey: 'sk-private' }
        : { auth: 'Bearer sk-private' },
    );
    const body = JSON.parse(requests.at(-1)!.body) as Record<string, unknown>;
    expect(body).toMatchObject(
      adapter.protocol === 'gemini-image'
        ? { contents: [{ role: 'user', parts: [{ text: '测试' }] }] }
        : { model: 'example-model', prompt: '测试' },
    );
    if (adapter.protocol === 'gemini-image')
      expect(requests.at(-1)?.url).toBe('/models/example-model:generateContent');
    const data =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aV1cAAAAASUVORK5CYII=';
    await adapter.submit(context, {
      ...request,
      mode: 'reference',
      inputs: [{ kind: 'image', role: 'reference', dataUrl: `data:image/png;base64,${data}` }],
    });
    if (adapter.protocol === 'openai-images') {
      expect(requests.at(-1)?.url).toBe('/images/edits');
      expect(requests.at(-1)?.contentType).toContain('multipart/form-data');
      expect(requests.at(-1)?.body).toContain('name="image[]"');
    } else expect(requests.at(-1)?.body).toContain(data);
    for (const [http, errorCode, category] of [
      [400, 'content_policy_violation', 'moderation'],
      [429, 'rate_limit_exceeded', 'rate_limit'],
      [401, 'invalid_api_key', 'auth'],
      [500, 'server_error', 'upstream'],
    ] as const) {
      status = http;
      code = errorCode;
      await expect(adapter.submit(context, request)).rejects.toMatchObject({
        category,
        uncertain: http === 500,
        safeRetry: http === 429,
      });
      await expect(adapter.submit(context, request)).rejects.not.toHaveProperty(
        'message',
        expect.stringContaining('sk-private'),
      );
    }
  });
}
it('图片档案按最长前缀匹配；显式档案优先且校验协议，统一媒体入口复用同一规则', () => {
  const model = {
    kind: 'image' as const,
    protocol: 'openai-images',
    profileId: null,
    upstreamModelId: 'gpt-image-1',
  };
  expect(imageProfile(model).generic).toBe(false);
  expect(imageProfile({ ...model, upstreamModelId: 'my-gpt-image-1' }).generic).toBe(true);
  expect(() => imageProfile({ ...model, profileId: 'gemini-image-default' })).toThrow();
  expect(() => mediaProfile({ ...model, profileId: 'missing' })).toThrow();
  for (const [upstreamModelId, id] of [
    ['gpt-image-2.5-flare-2026-09-08', 'openai-images-gpt-image-2.5'],
    ['gpt-image-2-2026-04-21', 'openai-images-gpt-image-2'],
    ['gpt-image-1-mini', 'openai-images-default'],
    ['chatgpt-image-latest', 'openai-images-default'],
    ['unknown', 'openai-images-generic'],
  ]) {
    expect(imageProfile({ ...model, upstreamModelId }).id).toBe(id);
    expect(mediaProfile({ ...model, upstreamModelId }).id).toBe(id);
  }
  expect(
    mediaProfile({ ...model, upstreamModelId: 'gpt-image-2.5', profileId: 'openai-images-generic' })
      .id,
  ).toBe('openai-images-generic');
  expect(imageProfiles).toHaveLength(11);
});

for (const adapter of [openaiImages, arkImages, geminiImage]) {
  const fixture = JSON.parse(
    readFileSync(new URL(`./fixtures/${adapter.protocol}.json`, import.meta.url), 'utf8'),
  ) as {
    requestCases: {
      model: string;
      params: GenerationRequest['params'];
      payload: Record<string, unknown>;
    }[];
  };
  for (const entry of fixture.requestCases) {
    it(`${adapter.protocol}：${entry.model} 请求固件只发送供应商字段`, async () => {
      status = 200;
      responseBody = fixture;
      const request = GenerationRequest.parse({
        modelId: '11111111-1111-4111-8111-111111111111',
        mode: 'text',
        prompt: '测试',
        params: { ...entry.params, unknown: true, size: 'bad', n: 4, model: '不可覆盖模型' },
      });
      const context = {
        baseUrl,
        apiKey: 'sk-private',
        headers: {},
        model: entry.model,
        signal: AbortSignal.timeout(10_000),
      };
      const result = await adapter.submit(context, request);
      expect(result).toMatchObject({
        status: 'succeeded',
        outputs: [{ mime: adapter.protocol === 'ark-images' ? 'image/jpeg' : 'image/png' }],
      });
      const body = JSON.parse(requests.at(-1)!.body) as Record<string, unknown>;
      expect(body).toEqual(
        adapter.protocol === 'gemini-image'
          ? {
              contents: [{ role: 'user', parts: [{ text: '测试' }] }],
              generationConfig: {
                responseModalities: ['TEXT', 'IMAGE'],
                imageConfig: entry.payload,
              },
            }
          : { model: entry.model, prompt: '测试', ...entry.payload },
      );
      if (adapter.protocol === 'openai-images') {
        await adapter.submit(context, {
          ...request,
          mode: 'reference',
          inputs: [{ kind: 'image', role: 'reference', dataUrl: 'data:image/png;base64,YQ==' }],
        });
        const form = await new Response(requests.at(-1)!.body, {
          headers: { 'Content-Type': requests.at(-1)!.contentType! },
        }).formData();
        const { 'image[]': image, ...fields } = Object.fromEntries(form);
        expect(image).toBeInstanceOf(File);
        expect(fields).toEqual(
          Object.fromEntries(
            Object.entries({ model: entry.model, prompt: '测试', ...entry.payload }).map(
              ([key, value]) => [key, String(value)],
            ),
          ),
        );
      }
    });
  }
}

it('提交使用任务的档案快照，显式通用档案不会按模型 ID 升级能力', async () => {
  status = 200;
  responseBody = JSON.parse(
    readFileSync(new URL('./fixtures/openai-images.json', import.meta.url), 'utf8'),
  );
  const profile = imageProfile({
    kind: 'image',
    protocol: 'openai-images',
    upstreamModelId: 'gpt-image-2.5',
    profileId: 'openai-images-generic',
  });
  await openaiImages.submit(
    {
      baseUrl,
      apiKey: '',
      headers: {},
      model: 'gpt-image-2.5',
      profile,
      signal: AbortSignal.timeout(10_000),
    },
    GenerationRequest.parse({
      modelId: '11111111-1111-4111-8111-111111111111',
      mode: 'text',
      prompt: '测试',
      params: { aspectRatio: '3:2', resolution: '4K', quality: 'max' },
    }),
  );
  expect(JSON.parse(requests.at(-1)!.body)).toEqual({
    model: 'gpt-image-2.5',
    prompt: '测试',
    size: '1536x1024',
    quality: 'high',
    background: 'auto',
  });
});
