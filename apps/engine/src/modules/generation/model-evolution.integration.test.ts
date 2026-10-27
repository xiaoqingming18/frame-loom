import type { INestApplication } from '@nestjs/common';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { expect, it } from 'vitest';
import { GenerationRequest, ModelImportPackage, ModelProfile } from '@frame-loom/contracts';
import { createEngine } from '../../application.js';
import { EngineConfig } from '../../core/config/config.js';
import { DatabaseService } from '../../core/database/database.service.js';
import { ChannelsRepository } from '../channels/channels.repository.js';
import { ModelCatalogService } from '../channels/model-catalog.service.js';
import { GenerationService } from './generation.service.js';
import { generationJobs } from './generation.schema.js';

it.each([
  { kind: 'video', template: 'seedance-2.5', mime: 'video/mp4' },
  { kind: 'image', template: 'openai-images-default', mime: 'image/png' },
  { kind: 'tts', template: 'openai-speech-default', mime: 'audio/wav' },
] as const)(
  '$kind 新定义导入后复用现有执行器，更新仅影响新任务且历史重启可解释',
  async ({ kind, template, mime }) => {
    const directory = await mkdtemp(join(tmpdir(), 'loom-evolution-'));
    const video = await readFile(new URL('./adapters/fixtures/reference.mp4', import.meta.url));
    const image = await readFile(
      new URL('../../../../desktop/e2e/fixtures/reference-256.png', import.meta.url),
    );
    const audio = Buffer.alloc(32044);
    audio.write('RIFF');
    audio.writeUInt32LE(audio.length - 8, 4);
    audio.write('WAVEfmt ', 8);
    audio.writeUInt32LE(16, 16);
    audio.writeUInt16LE(1, 20);
    audio.writeUInt16LE(1, 22);
    audio.writeUInt32LE(16000, 24);
    audio.writeUInt32LE(32000, 28);
    audio.writeUInt16LE(2, 32);
    audio.writeUInt16LE(16, 34);
    audio.write('data', 36);
    audio.writeUInt32LE(32000, 40);
    const requests: { path: string; body: Record<string, unknown> }[] = [];
    const violations: string[] = [];
    const server = createServer((req, res) => {
      if (req.method === 'GET' && req.url?.startsWith('/tenant/contents/generations/tasks/')) {
        if (req.headers.authorization !== 'Bearer fixture-secret')
          violations.push('查询未使用原账号凭据');
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify({
            id: req.url.split('/').at(-1),
            status: 'succeeded',
            content: { video_url: `${origin}/result.mp4` },
          }),
        );
        return;
      }
      if (req.method === 'GET' && req.url === '/result.mp4') {
        if (req.headers.authorization) violations.push('结果下载泄露渠道密钥');
        res.writeHead(200, { 'Content-Type': 'video/mp4' }).end(video);
        return;
      }
      void (async () => {
        const chunks: Buffer[] = [];
        for await (const chunk of req as AsyncIterable<Buffer>) chunks.push(chunk);
        if (
          req.method !== 'POST' ||
          !['/tenant/submit', '/tenant/revised'].includes(req.url ?? '') ||
          req.headers.authorization !== 'Bearer fixture-secret' ||
          !req.headers['content-type']?.includes('application/json')
        ) {
          violations.push(`${req.method} ${req.url} 的路径、鉴权或编码错误`);
          res.writeHead(400).end();
          return;
        }
        requests.push({
          path: req.url!,
          body: JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown>,
        });
        if (kind === 'tts') res.writeHead(200, { 'Content-Type': 'audio/wav' }).end(audio);
        else {
          res.setHeader('Content-Type', 'application/json');
          res.end(
            JSON.stringify(
              kind === 'image'
                ? { data: [{ b64_json: image.toString('base64') }] }
                : {
                    id: `remote-${requests.length}`,
                    status: 'succeeded',
                    content: { video_url: `${origin}/result.mp4` },
                  },
            ),
          );
        }
      })().catch((error: unknown) => {
        violations.push(String(error));
        res.writeHead(500).end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const config = new EngineConfig('a'.repeat(64), directory, [], 'b'.repeat(64));
    let app: INestApplication | undefined;
    try {
      app = await createEngine(config);
      await app.init();
      const channels = app.get(ChannelsRepository);
      const channel = channels.saveChannel({
        name: '模型演进验收',
        apiFormat: 'openai-completions',
        baseUrl: `${origin}/tenant`,
        apiKey: 'fixture-secret',
        enabled: true,
      });
      const catalog = app.get(ModelCatalogService);
      const before = catalog.get();
      const base = before.definitions.find((item) => item.id === template)!;
      const profile = ModelProfile.parse(base.profile);
      const connection = before.connections.find((item) => item.protocol === base.protocol)!;
      const definition = {
        ...base,
        id: `acceptance-${kind}`,
        name: `新增${kind}`,
        aliases: [`future-${kind}`],
        profile: {
          ...profile,
          id: `acceptance-${kind}`,
          matchIds: [`future-${kind}`],
          runtime: { ...profile.runtime, pollInitialMs: 1000, pollMaxMs: 1000 },
        },
      };
      const incoming = ModelImportPackage.parse({
        schema: before.schema,
        schemaVersion: 1,
        source: '本地扩展验收夹具，非供应商支持声明',
        definitions: [definition],
        connections: [
          {
            ...connection,
            id: `acceptance-${kind}`,
            routes: { ...connection.routes, submit: 'submit' },
          },
        ],
        bindings: [
          {
            channelId: channel.id,
            connectionId: `acceptance-${kind}`,
            modelDefinitionId: definition.id,
            upstreamModelId: `future-${kind}`,
          },
        ],
      });
      const preview = catalog.preview(incoming);
      expect(() =>
        catalog.preview({ ...incoming, definitions: [{ ...definition, version: 'v2' }] }),
      ).toThrow('版本不受支持');
      expect(() =>
        catalog.preview({
          ...incoming,
          mappings: {
            custom: { version: 'v1', rules: [{ type: 'field', from: 'duration', to: 'seconds' }] },
          },
        }),
      ).toThrow('尚不执行自定义字段映射');
      expect(() =>
        catalog.preview({
          ...incoming,
          connections: [{ ...incoming.connections[0], auth: 'custom-header' }],
        }),
      ).toThrow('渠道凭据鉴权');
      expect(catalog.get()).toEqual(before);
      expect(channels.listModels()).toEqual([]);
      expect(requests).toEqual([]);
      catalog.apply(incoming, preview.revision, false);
      expect(requests).toEqual([]);
      const model = channels.listModels()[0];
      expect(model).toMatchObject({
        kind,
        definitionId: definition.id,
        effectiveProfile: { id: definition.id },
      });
      const generation = app.get(GenerationService);
      const request = GenerationRequest.parse({
        modelId: model.id,
        mode: 'text',
        prompt: '扩展验收',
        params: kind === 'tts' ? { response_format: 'wav' } : {},
      });
      const oldJob = await generation.create(request);
      const db = app.get(DatabaseService).db;
      const stored = () =>
        db.select().from(generationJobs).where(eq(generationJobs.id, oldJob.id)).get()!;
      const frozen = stored().snapshot;
      expect(frozen).toMatchObject({
        version: 2,
        definitionId: definition.id,
        definitionVersion: 'v1',
        capabilityVersion: 'v1',
        adapterVersion: 'v1',
      });
      const update = {
        ...incoming,
        definitions: [
          {
            ...definition,
            name: '更新显示名',
            profile: { ...definition.profile, promptMaxLength: 100 },
          },
        ],
        connections: [
          { ...incoming.connections[0], routes: { ...connection.routes, submit: 'revised' } },
        ],
        bindings: [],
      };
      const change = catalog.preview(update);
      expect(change.affectedModels).toContain(model.displayName);
      expect(() => catalog.apply(update, change.revision, false)).toThrow();
      catalog.apply(update, change.revision, true);
      expect(stored().snapshot).toEqual(frozen);
      expect(stored().profile.promptMaxLength).not.toBe(100);
      const newJob = await generation.create(request);
      for (const job of [oldJob, newJob]) {
        await expect
          .poll(() => generation.get(job.id).status, { timeout: 10000 })
          .toBe('succeeded');
        expect(generation.get(job.id).outputs).toMatchObject([{ mime }]);
      }
      expect(requests.map((item) => item.path).sort()).toEqual([
        '/tenant/revised',
        '/tenant/submit',
      ]);
      for (const { body } of requests) {
        expect(body.model).toBe(`future-${kind}`);
        if (kind === 'tts')
          expect(body).toMatchObject({ input: '扩展验收', voice: 'alloy', response_format: 'wav' });
        if (kind === 'image')
          expect(body).toMatchObject({
            prompt: '扩展验收',
            size: '1024x1024',
            quality: 'medium',
            background: 'auto',
          });
        if (kind === 'video') expect(body.content).toEqual([{ type: 'text', text: '扩展验收' }]);
      }
      const history = generation.get(oldJob.id);
      expect(history.configVersion).not.toBe(generation.get(newJob.id).configVersion);
      expect(violations).toEqual([]);
      await app.close();
      app = await createEngine(config);
      await app.init();
      expect(app.get(GenerationService).get(oldJob.id)).toEqual(history);
      expect(app.get(ChannelsRepository).getModel(model.id).effectiveProfile?.promptMaxLength).toBe(
        100,
      );
      expect(requests).toHaveLength(2);
      expect(JSON.stringify(app.get(GenerationService).list())).not.toContain('fixture-secret');
    } finally {
      await app?.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(directory, { recursive: true, force: true });
    }
  },
  30000,
);
