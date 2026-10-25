import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { GenerationRequest } from '@frame-loom/contracts';
import { openaiImages } from './openai-images.js';
import { arkImages } from './ark-images.js';
import { geminiImage } from './gemini-image.js';
import { imageProfiles, imageProfile } from '../profiles/image-profiles.js';

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
it('档案仅精确匹配，同协议的未知模型使用通用档案，显式错误档案被拒绝', () => {
  const model = {
    kind: 'image' as const,
    protocol: 'openai-images',
    profileId: null,
    upstreamModelId: 'gpt-image-1',
  };
  expect(imageProfile(model).generic).toBe(false);
  expect(imageProfile({ ...model, upstreamModelId: 'my-gpt-image-1' }).generic).toBe(true);
  expect(() => imageProfile({ ...model, profileId: 'gemini-image-default' })).toThrow();
  expect(imageProfiles).toHaveLength(6);
});
