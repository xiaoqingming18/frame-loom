import { afterEach, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getProtocol, PROTOCOLS } from '@frame-loom/contracts';
import { Channel, Model, ModelWrite } from '@frame-loom/contracts/model-service';
import { testEngine } from '../../testing/test-engine.js';
import { mockUpstream } from '../../testing/mock-upstream.js';
import { ModelServicesRepository } from './model-services.repository.js';
import { CatalogService } from './catalog.service.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
async function setup() {
  const s = await testEngine();
  cleanups.push(() => s.close());
  return s;
}
const secret = 'test-only-api-secret-12345';
function write(id = 'model') {
  return ModelWrite.parse({
    kind: 'chat',
    upstreamModelId: id,
    displayName: '模型',
    protocolId: 'openai-chat',
    capability: getProtocol('openai-chat')!.templates.chat,
    enabled: true,
  });
}
it('全部协议的请求体预览复用实际构造链且不联网、不读取或返回凭据', async () => {
  const s = await setup();
  const upstream = await mockUpstream([]);
  cleanups.push(() => upstream.close());
  const repo = s.app.get(ModelServicesRepository);
  const channel = repo.saveChannel({
    name: '预览',
    baseUrl: upstream.origin,
    apiKey: secret,
    headers: { 'x-private': 'preview-secret-header' },
    enabled: true,
  });
  for (const descriptor of PROTOCOLS) {
    for (const [kind, capability] of Object.entries(descriptor.templates)) {
      const [model] = repo.saveModels(channel.id, [
        ModelWrite.parse({
          kind,
          capability,
          protocolId: descriptor.id,
          upstreamModelId: `${descriptor.id}-${kind}`,
          displayName: '预览',
          enabled: false,
        }),
      ]);
      const response = await s.request(`/models/${model.id}/preview-request`, 'POST');
      const preview: unknown = await response.json();
      expect(response.status, JSON.stringify(preview)).toBe(201);
      expect(preview).toHaveProperty('method', 'POST');
      expect(preview).toHaveProperty('body');
      expect(JSON.stringify(preview)).not.toMatch(
        /test-only-api-secret|preview-secret-header|Authorization|x-api-key/,
      );
    }
  }
  expect(upstream.requests).toHaveLength(0);
});
it('渠道 CRUD 密钥缺省保留、显式清除，读取与数据库 WAL 均不泄露凭据', async () => {
  const s = await setup();
  const created = Channel.parse(
    await (
      await s.request('/channels', 'POST', {
        name: '渠道',
        baseUrl: 'http://127.0.0.1:1',
        apiKey: secret,
        secretKey: 'test-only-secret-key',
        headers: { 'x-private': 'test-only-header-value' },
        enabled: true,
      })
    ).json(),
  );
  expect(created).toMatchObject({
    hasKey: true,
    hasSecretKey: true,
    keyHint: '••••2345',
    headerNames: ['x-private'],
  });
  expect(JSON.stringify(created)).not.toContain(secret);
  await s.request(`/channels/${created.id}`, 'PATCH', { name: '已更名' });
  const repo = s.app.get(ModelServicesRepository);
  expect(repo.credentials(created.id)).toMatchObject({
    apiKey: secret,
    secretKey: 'test-only-secret-key',
    headers: { 'x-private': 'test-only-header-value' },
  });
  for (const suffix of ['', '-wal']) {
    const bytes = await readFile(join(s.directory, `data/frame-loom.sqlite${suffix}`));
    for (const value of [secret, 'test-only-secret-key', 'test-only-header-value'])
      expect(bytes.includes(Buffer.from(value))).toBe(false);
  }
  const cleared = Channel.parse(
    await (
      await s.request(`/channels/${created.id}`, 'PATCH', {
        apiKey: '',
        secretKey: '',
        headers: {},
      })
    ).json(),
  );
  expect(cleared).toMatchObject({ hasKey: false, hasSecretKey: false, headerNames: [] });
  expect((await s.request(`/channels/${created.id}`)).status).toBe(200);
});
it('批量创建整体事务，字段校验，默认模型类别，测试哈希失效和导出无凭据', async () => {
  const s = await setup();
  const repo = s.app.get(ModelServicesRepository);
  const channel = repo.saveChannel({
    name: '渠道',
    baseUrl: 'http://127.0.0.1:1',
    apiKey: secret,
    enabled: true,
  });
  expect(
    (await s.request(`/channels/${channel.id}/models`, 'POST', [write(), write()])).status,
  ).toBe(409);
  expect(repo.listModels(channel.id)).toEqual([]);
  const models = Model.array().parse(
    await (await s.request(`/channels/${channel.id}/models`, 'POST', [write()])).json(),
  );
  const saved = models[0];
  expect((await s.request('/model-defaults', 'PUT', { image: saved.id })).status).toBe(422);
  expect((await s.request('/model-defaults', 'PUT', { chat: saved.id })).status).toBe(200);
  repo.recordCheck(saved.id, {
    type: 'chat',
    ok: true,
    checkedAt: new Date().toISOString(),
    configHash: saved.configHash,
    code: null,
    message: '测试通过',
  });
  expect(repo.getModel(saved.id).lastCheck?.ok).toBe(true);
  await s.request(`/models/${saved.id}`, 'PUT', { ...write(), displayName: '更名' });
  expect(repo.getModel(saved.id).lastCheck).toBeNull();
  const exported = (await (await s.request(`/models/${saved.id}/export`)).json()) as {
    model: Record<string, unknown>;
  };
  expect(JSON.stringify(exported)).not.toMatch(/confirmedHosts|apiKey|secretKey|headers|enabled/);
  expect((await s.request(`/channels/${channel.id}/models/import`, 'POST', exported)).status).toBe(
    201,
  );
  expect(repo.listModels(channel.id)).toHaveLength(1);
  for (const invalid of [
    { ...write('empty'), protocolId: null },
    {
      ...write('foreign'),
      endpointOverride: { submitUrl: 'http://127.0.0.1:2/v1/chat/completions', confirmedHosts: [] },
    },
    { ...write('ceiling'), capability: { ...write().capability, inputModalities: ['pdf'] } },
  ]) {
    const response = await s.request(`/channels/${channel.id}/models`, 'POST', [invalid]);
    expect(response.status).toBe(422);
    expect(JSON.stringify(await response.json())).toContain('field');
  }
  expect(await (await s.request(`/channels/${channel.id}`, 'DELETE')).json()).toEqual({
    deleted: true,
    models: 1,
  });
  expect((await s.request(`/models/${saved.id}`)).status).toBe(404);
  expect(repo.defaults().chat).toBeNull();
});
it.each(['openai', 'anthropic', 'gemini'] as const)(
  '读取 %s 只按返回字段推断，严格路径和鉴权，草稿不落库',
  async (format) => {
    const s = await setup();
    const path = format === 'gemini' ? '/gateway/v1beta/models' : '/gateway/v1/models';
    const headers: Record<string, string> =
      format === 'openai'
        ? { authorization: `Bearer ${secret}` }
        : format === 'anthropic'
          ? { 'x-api-key': secret, 'anthropic-version': '2023-06-01' }
          : { 'x-goog-api-key': secret };
    const body =
      format === 'gemini'
        ? {
            models: [{ name: 'models/arbitrary', supportedGenerationMethods: ['generateContent'] }],
          }
        : {
            data: [
              { id: 'gpt-image-misleading' },
              { id: 'arbitrary', supported_endpoint_types: ['openai', 'openai-response'] },
              { id: 'picture', architecture: { output_modalities: ['image'] } },
              { id: 'picture' },
            ],
          };
    const upstream = await mockUpstream([
      { method: 'GET', path, headers, reply: () => ({ body: JSON.stringify(body) }) },
    ]);
    cleanups.push(() => upstream.close());
    const repo = s.app.get(ModelServicesRepository);
    const channel = repo.saveChannel({
      name: '测试',
      baseUrl: `${upstream.origin}/gateway/v1`,
      apiKey: secret,
      enabled: true,
    });
    const response = await s.request('/channels/catalog', 'POST', {
      baseUrl: channel.baseUrl,
      catalogFormat: format,
      channelId: channel.id,
    });
    expect(response.status).toBe(201);
    const candidates = (await response.json()) as {
      id: string;
      kind: string | null;
      protocolId: string | null;
    }[];
    expect(candidates.find((candidate) => candidate.id === 'arbitrary')).toMatchObject({
      kind: 'chat',
      protocolId: format === 'gemini' ? 'gemini-generate' : 'openai-responses',
    });
    if (format !== 'gemini')
      expect(candidates.find((candidate) => candidate.id === 'gpt-image-misleading')).toMatchObject(
        { kind: null, protocolId: null },
      );
    expect(repo.listModels(channel.id)).toEqual([]);
    expect(upstream.requests).toHaveLength(1);
    expect(upstream.violations).toEqual([]);
  },
);
it('读取模型拒绝重定向、取消与无效响应，不泄露上游正文', async () => {
  const s = await setup();
  let targetRequests = 0;
  const upstream = await mockUpstream([
    {
      method: 'GET',
      path: '/v1/models',
      reply: () => ({ status: 302, headers: { Location: '/target' } }),
    },
    {
      method: 'GET',
      path: '/target',
      reply: () => {
        targetRequests++;
        return {};
      },
    },
  ]);
  cleanups.push(() => upstream.close());
  const catalog = s.app.get(CatalogService);
  const input = { baseUrl: upstream.origin, catalogFormat: 'openai' as const, apiKey: secret };
  await expect(catalog.read(input)).rejects.toMatchObject({ code: 'CONNECTION_FAILED' });
  expect(targetRequests).toBe(0);
  const controller = new AbortController();
  controller.abort(new DOMException('超时', 'TimeoutError'));
  await expect(catalog.read(input, controller.signal)).rejects.toMatchObject({
    code: 'REQUEST_TIMEOUT',
  });
});
