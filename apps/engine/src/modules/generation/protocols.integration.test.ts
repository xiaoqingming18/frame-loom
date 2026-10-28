import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { getProtocol, type ProjectSummary, type ProjectPageSummary } from '@frame-loom/contracts';
import { Channel, Model, ModelWrite, GenerationJob } from '@frame-loom/contracts/model-service';
import { testEngine } from '../../testing/test-engine.js';
import { mockUpstream, type MockRoute } from '../../testing/mock-upstream.js';
import { png } from '../../testing/protocol-context.js';
import { MediaService } from './media.service.js';
import { pcmWav } from './protocols/audio.js';

it('HTTP 创建渠道和模型，图像／视频／TTS 写回项目，完整预览地址与实际请求一致', async () => {
  const video = await readFile(new URL('./protocols/fixtures/reference.mp4', import.meta.url));
  const wav = pcmWav(Buffer.alloc(4800));
  let origin = '';
  const routes: MockRoute[] = [
    {
      method: 'GET',
      path: '/v1/models',
      headers: { authorization: 'Bearer test-key' },
      reply: () => ({ body: '{"data":[]}' }),
    },
    {
      method: 'POST',
      path: '/v1/responses',
      headers: { authorization: 'Bearer test-key' },
      reply: () => ({
        headers: { 'content-type': 'text/event-stream' },
        body: [
          { type: 'response.created', response: { id: 'r1' } },
          {
            type: 'response.output_item.added',
            output_index: 0,
            item: { id: 'm1', type: 'message', role: 'assistant', content: [] },
          },
          { type: 'response.output_text.delta', output_index: 0, content_index: 0, delta: 'OK' },
          {
            type: 'response.completed',
            response: {
              id: 'r1',
              status: 'completed',
              output: [],
              usage: { input_tokens: 2, output_tokens: 1, total_tokens: 3 },
            },
          },
        ]
          .map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
          .join(''),
      }),
    },
    {
      method: 'POST',
      path: '/v1/images/generations',
      headers: { authorization: 'Bearer test-key' },
      reply: () => ({ body: JSON.stringify({ data: [{ b64_json: png.toString('base64') }] }) }),
    },
    {
      method: 'POST',
      path: '/v1beta/models/tts-alias:generateContent',
      headers: { 'x-goog-api-key': 'test-key' },
      reply: () => ({
        body: JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    inlineData: {
                      mimeType: 'audio/L16;rate=24000',
                      data: Buffer.alloc(4800).toString('base64'),
                    },
                  },
                ],
              },
            },
          ],
        }),
      }),
    },
    {
      method: 'POST',
      path: '/minimax/v2/video_generation',
      headers: { authorization: 'Bearer test-key' },
      reply: () => ({
        body: JSON.stringify({ task_id: 'outer-id', base_resp: { status_code: 0 } }),
      }),
    },
    {
      method: 'GET',
      path: '/minimax/v2/query/video_generation/outer-id',
      headers: { authorization: 'Bearer test-key' },
      reply: () => ({
        body: JSON.stringify({
          task: { id: 'outer-id', status: 'succeeded', content: { url: origin + '/result.mp4' } },
        }),
      }),
    },
    {
      method: 'GET',
      path: '/result.mp4',
      reply: (req) => {
        expect(req.headers.authorization).toBeUndefined();
        return { headers: { 'content-type': 'video/mp4' }, body: video };
      },
    },
  ];
  const upstream = await mockUpstream(routes);
  origin = upstream.origin;
  const engine = await testEngine();
  try {
    const channel = Channel.parse(
      await (
        await engine.request('/channels', 'POST', {
          name: '流光模拟',
          baseUrl: origin + '/v1',
          apiKey: 'test-key',
          enabled: true,
        })
      ).json(),
    );
    const writes = [
      { kind: 'chat', upstreamModelId: 'chat-alias', protocolId: 'openai-responses' },
      { kind: 'image', upstreamModelId: 'image-alias', protocolId: 'openai-images' },
      { kind: 'tts', upstreamModelId: 'tts-alias', protocolId: 'gemini-generate' },
      {
        kind: 'video',
        upstreamModelId: 'video-alias',
        protocolId: 'minimax-video-v2',
        endpointOverride: {
          submitUrl: origin + '/minimax/v2/video_generation',
          operations: { query: origin + '/minimax/v2/query/video_generation/{id}' },
          confirmedHosts: [],
        },
      },
    ].map((value) =>
      ModelWrite.parse({
        ...value,
        displayName: value.kind,
        capability: getProtocol(value.protocolId)!.templates[
          value.kind as 'chat' | 'image' | 'video' | 'tts'
        ],
        enabled: true,
      }),
    );
    const models = Model.array().parse(
      await (await engine.request(`/channels/${channel.id}/models`, 'POST', writes)).json(),
    );
    const project = (await (
      await engine.request('/projects', 'POST', { name: '产物项目', location: engine.directory })
    ).json()) as ProjectSummary;
    const page = (await (
      await engine.request(`/projects/${project.id}/pages`, 'POST', { name: '创作' })
    ).json()) as ProjectPageSummary;
    for (const model of models) {
      if (model.kind === 'chat') {
        expect(
          await (await engine.request(`/models/${model.id}/check`, 'POST')).json(),
        ).toMatchObject({ ok: true });
        expect(
          upstream.requests.some(
            (req) =>
              req.method === 'POST' &&
              req.path === new URL(model.endpoints.operations.submit!.url).pathname,
          ),
        ).toBe(true);
        continue;
      }
      const response = await engine.request('/generation-jobs', 'POST', {
        modelId: model.id,
        projectId: project.id,
        pageId: page.id,
        prompt: '测试',
        source: 'test',
        inputs: [],
        ...(model.kind === 'video' ? { mode: 't2v' } : {}),
      });
      expect(response.status).toBe(201);
      const created = GenerationJob.parse(await response.json());
      let job = created;
      await expect
        .poll(
          async () => {
            job = GenerationJob.parse(
              await (await engine.request(`/generation-jobs/${created.id}`)).json(),
            );
            return job.status;
          },
          { timeout: 10000 },
        )
        .toBe('succeeded');
      expect(job.outputs).toHaveLength(1);
      const stored = await engine.app.get(MediaService).resolve(job.outputs[0].sha256, project.id);
      const bytes = await readFile(stored.path);
      expect(bytes).toEqual(model.kind === 'image' ? png : model.kind === 'tts' ? wav : video);
      const submit = new URL(model.endpoints.operations.submit!.url).pathname;
      expect(
        upstream.requests.filter((req) => req.method === 'POST' && req.path === submit),
      ).toHaveLength(1);
      if (model.kind === 'video')
        expect(
          upstream.requests.some(
            (req) =>
              req.path ===
              new URL(model.endpoints.operations.query!.url.replace('{id}', 'outer-id')).pathname,
          ),
        ).toBe(true);
    }
    expect(upstream.violations).toEqual([]);
  } finally {
    await engine.close();
    await upstream.close();
  }
}, 15000);
