import { afterEach, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { eq } from 'drizzle-orm';
import { ModelWrite, SemanticRequest } from '@frame-loom/contracts';
import { testEngine } from '../../testing/test-engine.js';
import { mockUpstream } from '../../testing/mock-upstream.js';
import { ModelServicesRepository } from '../model-services/model-services.repository.js';
import { DatabaseService } from '../../core/database/database.service.js';
import { GenerationService } from './generation.service.js';
import { MediaService } from './media.service.js';
import { generationJobs } from './generation.schema.js';
import { openaiImages } from './protocols/openai-images.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function setup(wrong = false) {
  let output: Buffer = Buffer.alloc(0);
  let downloads = 0;
  let origin = '';
  const upstream = await mockUpstream([
    {
      method: 'POST',
      path: '/v1/images/edits',
      reply: async (req) => {
        const match = /name="size"\r\n\r\n(\d+)x(\d+)/.exec(req.body);
        expect(match).not.toBeNull();
        const width = wrong ? 512 : Number(match![1]);
        const height = wrong ? 512 : Number(match![2]);
        output = await sharp({ create: { width, height, channels: 4, background: '#304050' } })
          .png()
          .toBuffer();
        return { body: JSON.stringify({ data: [{ url: `${origin}/output.png` }] }) };
      },
    },
    {
      method: 'GET',
      path: '/output.png',
      reply: () => {
        downloads++;
        return { headers: { 'Content-Type': 'image/png' }, body: output };
      },
    },
  ]);
  origin = upstream.origin;
  cleanups.push(() => upstream.close());
  const engine = await testEngine();
  cleanups.push(() => engine.close());
  const repo = engine.app.get(ModelServicesRepository);
  const channel = repo.saveChannel({
    name: '本地几何测试',
    baseUrl: origin + '/v1',
    apiKey: 'local-test',
    enabled: true,
  });
  const model = repo.saveModels(channel.id, [
    ModelWrite.parse({
      kind: 'image',
      upstreamModelId: 'geometry-test',
      displayName: '测试',
      protocolId: 'openai-images',
      capability: openaiImages.descriptor.templates.image,
      enabled: true,
    }),
  ])[0];
  return {
    engine,
    upstream,
    model,
    get downloads() {
      return downloads;
    },
  };
}

it.each([false, true])('全景冻结尺寸，比例错误保留原图，重启仅恢复后处理：%s', async (wrong) => {
  const t = await setup(wrong);
  const media = t.engine.app.get(MediaService);
  const source = await media.saveStream([
    await sharp({
      create: {
        width: 128,
        height: 128,
        channels: 4,
        background: '#304050',
      },
    })
      .png()
      .toBuffer(),
  ]);
  const service = t.engine.app.get(GenerationService);
  const job = await service.create(
    SemanticRequest.parse({
      modelId: t.model.id,
      prompt: '全景',
      source: 'canvas',
      inputs: [],
      params: { width: 512, height: 512, count: 2 },
      imageEdit: {
        version: 1,
        operation: 'panorama',
        sceneHint: '',
        source: { nodeId: 'source', sha256: source.sha256 },
      },
    }),
  );
  expect(job.request.params).toMatchObject({ width: 2880, height: 1440, count: 1 });
  expect(job.request.imageEdit?.geometry?.expected).toEqual({
    ratio: 2,
    width: 2880,
    height: 1440,
  });
  await expect.poll(() => service.get(job.id).status).toBe('succeeded');
  const db = t.engine.app.get(DatabaseService).db;
  const stored = db.select().from(generationJobs).where(eq(generationJobs.id, job.id)).get()!;
  const intermediate = stored.snapshot.imageEditPostProcess!.intermediateSha256;
  if (wrong) {
    expect(service.get(job.id).outputs[0].sha256).toBe(intermediate);
    expect(service.get(job.id).diagnostic?.message).toContain('输出不是 2:1');
  } else expect(service.get(job.id).outputs[0]).toMatchObject({ width: 2880, height: 1440 });
  db.update(generationJobs)
    .set({
      status: 'paused',
      outputs: [],
      snapshot: { ...stored.snapshot, imageEditPostProcess: { intermediateSha256: intermediate } },
      rawResponse: [{ kind: 'url', url: `${t.upstream.origin}/output.png`, mime: 'image/png' }],
    })
    .where(eq(generationJobs.id, job.id))
    .run();
  await t.engine.restart();
  const restarted = t.engine.app.get(GenerationService);
  restarted.requery(job.id);
  await expect.poll(() => restarted.get(job.id).status).toBe('succeeded');
  expect(t.downloads).toBe(1);
  expect(t.upstream.requests.filter((req) => req.method === 'POST')).toHaveLength(1);
});

it.each([false, true])('真实适配器冻结竖图尺寸、比例失败仅重试合成：错误比例=%s', async (wrong) => {
  const t = await setup(wrong);
  const media = t.engine.app.get(MediaService);
  const source = await media.saveStream([
    await sharp({ create: { width: 250, height: 357, channels: 4, background: '#203040' } })
      .png()
      .toBuffer(),
  ]);
  const service = t.engine.app.get(GenerationService);
  const job = await service.create(
    SemanticRequest.parse({
      modelId: t.model.id,
      prompt: '测试',
      source: 'canvas',
      inputs: [],
      params: { width: 1024, height: 1024 },
      imageEdit: {
        version: 1,
        operation: 'emotion',
        source: { nodeId: 'source', sha256: source.sha256 },
        targetFace: { x: 50, y: 40, width: 100, height: 170 },
        editRegion: { x: 0, y: 0, width: 250, height: 357 },
        imageWidth: 250,
        imageHeight: 357,
        presetId: 'neutral',
        intimacy: 0,
        arousal: 0,
        characterName: '',
        maskMode: 'local',
      },
    }),
  );
  const geometry = job.request.imageEdit!.geometry!;
  expect(
    Math.abs(
      job.request.params.width! /
        job.request.params.height! /
        ((geometry.crop.width + geometry.pad.left + geometry.pad.right) /
          (geometry.crop.height + geometry.pad.top + geometry.pad.bottom)) -
        1,
    ),
  ).toBeLessThan(0.01);
  await expect.poll(() => service.get(job.id).status).toBe(wrong ? 'download_failed' : 'succeeded');
  if (wrong) {
    const db = t.engine.app.get(DatabaseService).db;
    const stored = db.select().from(generationJobs).where(eq(generationJobs.id, job.id)).get()!;
    expect(stored.snapshot.imageEditPostProcess?.intermediateSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(service.get(job.id).errorMessage).toContain('输出比例');
    const save = vi.spyOn(media, 'save');
    await service.resubmit(job.id);
    await expect.poll(() => service.get(job.id).status).toBe('download_failed');
    expect(save).not.toHaveBeenCalled();
    expect(t.downloads).toBe(1);
    save.mockRestore();
  } else expect(service.get(job.id).outputs[0]).toMatchObject({ width: 250, height: 357 });
  expect(t.upstream.requests.filter((req) => req.method === 'POST')).toHaveLength(1);
});

it('无 geometry 的在途任务重启后可完成并记录等比降级', async () => {
  const t = await setup();
  const sourceBytes = await sharp({
    create: { width: 80, height: 120, channels: 4, background: '#203040' },
  })
    .png()
    .toBuffer();
  const media = t.engine.app.get(MediaService);
  const source = await media.saveStream([sourceBytes]);
  const service = t.engine.app.get(GenerationService);
  const job = await service.create(
    SemanticRequest.parse({
      modelId: t.model.id,
      prompt: '测试',
      source: 'canvas',
      inputs: [],
      imageEdit: {
        version: 1,
        operation: 'emotion',
        source: { nodeId: 'source', sha256: source.sha256 },
        targetFace: { x: 10, y: 10, width: 40, height: 60 },
        editRegion: { x: 0, y: 0, width: 80, height: 120 },
        imageWidth: 80,
        imageHeight: 120,
        presetId: 'neutral',
        intimacy: 0,
        arousal: 0,
        characterName: '',
        maskMode: 'local',
      },
    }),
  );
  const db = t.engine.app.get(DatabaseService).db;
  const row = db.select().from(generationJobs).where(eq(generationJobs.id, job.id)).get()!;
  delete row.request.imageEdit!.geometry;
  db.update(generationJobs)
    .set({
      request: row.request,
      status: 'paused',
      rawResponse: [{ kind: 'data', base64: sourceBytes.toString('base64'), mime: 'image/png' }],
    })
    .where(eq(generationJobs.id, job.id))
    .run();
  await t.engine.restart();
  const restarted = t.engine.app.get(GenerationService);
  restarted.requery(job.id);
  await expect.poll(() => restarted.get(job.id).status).toBe('succeeded');
  expect(restarted.get(job.id).outputs[0]).toMatchObject({ width: 80, height: 120 });
  expect(restarted.get(job.id).diagnostic?.message).toContain('降级');
  expect(t.upstream.requests).toHaveLength(0);
});

it.each(['angle', 'lighting'] as const)(
  '整图编辑 %s 默认同比例，输出不符仅警告',
  async (operation) => {
    const t = await setup(true);
    const source = await t.engine.app.get(MediaService).saveStream([
      await sharp({ create: { width: 250, height: 357, channels: 4, background: '#203040' } })
        .png()
        .toBuffer(),
    ]);
    const service = t.engine.app.get(GenerationService);
    const job = await service.create(
      SemanticRequest.parse({
        modelId: t.model.id,
        prompt: '测试',
        source: 'canvas',
        inputs: [{ kind: 'image', role: 'reference', order: 0, sha256: source.sha256 }],
        imageEdit: {
          version: 1,
          source: { nodeId: 'source', sha256: source.sha256 },
          operation,
          ...(operation === 'angle'
            ? { horizontalAngle: 0, pitchAngle: 0, cameraDistance: 4.8, lens: 'standard' }
            : {
                azimuth: 0,
                elevation: 0,
                brightness: 50,
                rimLight: false,
                stylePreset: '',
                smartMode: true,
                lightColor: '#ffffff',
              }),
        },
      }),
    );
    expect(
      Math.abs(job.request.params.width! / job.request.params.height! / (250 / 357) - 1),
    ).toBeLessThan(0.01);
    await expect.poll(() => service.get(job.id).status).toBe('succeeded');
    expect(service.get(job.id).diagnostic?.message).toContain('输出比例');
    if (operation === 'lighting') {
      const manual = await service.create({
        ...job.request,
        params: { width: 1024, height: 1024 },
      });
      expect(manual.request.imageEdit?.geometry?.expected.ratio).toBe(1);
      await expect.poll(() => service.get(manual.id).status).toBe('succeeded');
      expect(service.get(manual.id).diagnostic?.message).toBeUndefined();
    }
  },
);
