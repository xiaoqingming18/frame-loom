import { afterEach, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { mkdtemp, mkdir, cp, readFile, readdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createEngine } from '../../application.js';
import { EngineConfig } from '../../core/config/config.js';
import { EngineLogger } from '../../core/logging/engine-logger.js';
import { SecretCipher } from '../../core/crypto/secret-cipher.js';
import { DatabaseService } from '../../core/database/database.service.js';
import { packageRoot } from '../../package-root.js';
import { ChannelsRepository } from './channels.repository.js';
import { channelModels, modelCatalog } from './channels.schema.js';
import { GenerationService, GenerationAdapters } from '../generation/generation.service.js';
import { generationJobs } from '../generation/generation.schema.js';
import { mediaProfiles } from '../generation/profiles/media-profiles.js';
import { ModelCatalogService } from './model-catalog.service.js';

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
const ids = Array.from(
  { length: 14 },
  (_, n) => `11111111-1111-4111-8111-${String(n).padStart(12, '0')}`,
);
async function legacyDatabase() {
  const directory = await mkdtemp(join(tmpdir(), 'loom-model-upgrade-'));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const migrations = join(directory, 'legacy');
  await cp(fileURLToPath(new URL('drizzle/', packageRoot)), migrations, { recursive: true });
  const journalPath = join(migrations, 'meta/_journal.json');
  const journal = JSON.parse(await readFile(journalPath, 'utf8')) as { entries: unknown[] };
  await writeFile(
    journalPath,
    JSON.stringify({ ...journal, entries: journal.entries.slice(0, 12) }),
  );
  await mkdir(join(directory, 'data'));
  const sqlite = new Database(join(directory, 'data/frame-loom.sqlite'));
  migrate(drizzle(sqlite), { migrationsFolder: migrations });
  return { directory, sqlite };
}
it('旧库混合模态升级保留有效地址与密钥，精确退出旧视频，重启查询不重投，完成后回收引用', async () => {
  const { directory, sqlite } = await legacyDatabase();
  const config = new EngineConfig('a'.repeat(64), directory, [], 'b'.repeat(64));
  const cipher = new SecretCipher(config, new EngineLogger(config.token));
  const baseUrl = 'https://example.test/deploy/v1';
  sqlite
    .prepare(
      `INSERT INTO channels (id,name,api_format,base_url,api_key_cipher,header_names,enabled,created_at,updated_at) VALUES (?, '旧渠道', 'openai-completions', ?, ?, '[]', 1, '2026-10-27T00:00:00.000Z', '2026-10-27T00:00:00.000Z')`,
    )
    .run(ids[0], baseUrl, cipher.encrypt('original-key', 'channels', ids[0]));
  const insert = sqlite.prepare(
    `INSERT INTO channel_models (id,channel_id,upstream_model_id,display_name,kind,protocol,profile_id,overrides_json,connection_json,enabled) VALUES (?, ?, ?, ?, ?, ?, NULL, '{}', '{}', 1)`,
  );
  for (const [index, model, kind, protocol] of [
    [1, 'sora-2', 'video', 'openai-videos'],
    [2, 'sora-2-pro-cost', 'video', 'openai-videos'],
    [3, 'doubao-seedance-2-0', 'video', 'ark-video-tasks'],
    [4, 'gpt-4o', 'chat', 'openai-completions'],
    [5, 'gpt-image-1', 'image', 'openai-images'],
    [6, 'tts-1', 'tts', 'openai-speech'],
  ] as const)
    insert.run(ids[index], ids[0], model, model, kind, protocol);
  sqlite.prepare("INSERT INTO model_defaults VALUES ('video', ?)").run(ids[1]);
  const profile = mediaProfiles.find((item) => item.id === 'openai-videos-default')!;
  const snapshot = {
    version: 1,
    channelId: ids[0],
    credentialFingerprint: createHash('sha256')
      .update(JSON.stringify([ids[0], 'original-key', []]))
      .digest('hex'),
    baseUrl,
    model: 'sora-2',
    connection: { baseUrl, routes: { query: 'old/videos/{id}' } },
    idempotencyKey: ids[7],
    referenceUrls: {},
  };
  const request = {
    modelId: ids[1],
    mode: 'text',
    prompt: '历史内容',
    params: {},
    inputs: [],
    source: 'canvas',
  };
  sqlite
    .prepare(
      `INSERT INTO generation_jobs (id,kind,channel_model_id,profile_id,profile_json,status,request_json,snapshot_json,remote_task_id,outputs_json,source,created_at,updated_at,deadline_at) VALUES (?, 'video', ?, ?, ?, 'paused', ?, ?, 'remote-original', '[]', 'canvas', ?, ?, ?)`,
    )
    .run(
      ids[7],
      ids[1],
      profile.id,
      JSON.stringify(profile),
      JSON.stringify(request),
      JSON.stringify(snapshot),
      new Date().toISOString(),
      new Date().toISOString(),
      new Date(Date.now() + 60000).toISOString(),
    );
  sqlite.close();
  let app = await createEngine(config);
  let closed = false;
  cleanups.push(async () => {
    if (!closed) await app.close();
  });
  await app.init();
  let repository = app.get(ChannelsRepository);
  const models = repository.listModels();
  expect(models.map((model) => model.id)).toEqual([ids[3], ids[4], ids[5], ids[6]]);
  for (const model of models) {
    expect(model.definitionId).toBeTruthy();
    expect(model.connection?.baseUrl).toBe(baseUrl);
  }
  expect(repository.defaults().video).toBeNull();
  expect(repository.retirementReport()).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        upstreamModelId: 'sora-2',
        reason: 'retired',
        tasks: [expect.objectContaining({ id: ids[7] })],
      }),
      expect.objectContaining({ upstreamModelId: 'sora-2-pro-cost', reason: 'unconfirmed' }),
    ]),
  );
  expect(() => repository.saveChannel({ apiKey: 'replacement' }, ids[0])).toThrow('历史任务仍需');
  expect(() => repository.deleteChannel(ids[0])).toThrow('历史任务仍需');
  expect(() =>
    repository.saveModel(ids[0], {
      upstreamModelId: 'sora-2',
      displayName: '绕过',
      kind: 'video',
      protocol: 'openai-videos',
      profileId: null,
      enabled: true,
      overrides: {},
    }),
  ).toThrow('旧视频型号');
  const catalog = app.get(ModelCatalogService);
  const imported = structuredClone(catalog.get());
  imported.bindings = [
    {
      id: ids[1],
      channelId: ids[0],
      modelDefinitionId: 'seedance-2.5',
      connectionId: 'ark-video-tasks',
      upstreamModelId: 'new-id',
      enabled: true,
      capabilityLimit: {},
    },
  ];
  expect(() => catalog.preview(imported)).toThrow('退出绑定');
  const backups = (await readdir(join(directory, 'data'))).filter((name) =>
    name.includes('.before-'),
  );
  expect(backups).toHaveLength(1);
  const backup = new Database(join(directory, 'data', backups[0]), { readonly: true });
  expect(backup.prepare('SELECT count(*) AS count FROM channel_models').get()).toEqual({
    count: 6,
  });
  const backedChannel = backup.prepare('SELECT api_key_cipher FROM channels').get() as {
    api_key_cipher: Buffer;
  };
  expect(cipher.decrypt(backedChannel.api_key_cipher, 'channels', ids[0])).toBe('original-key');
  backup.close();
  await app.close();
  app = await createEngine(config);
  await app.init();
  repository = app.get(ChannelsRepository);
  const generation = app.get(GenerationService);
  const db = app.get(DatabaseService).db;
  const original = db.select().from(generationJobs).where(eq(generationJobs.id, ids[7])).get()!;
  for (const [id, status] of [
    [ids[8], 'pending'],
    [ids[9], 'submit_unknown'],
    [ids[10], 'download_failed'],
  ] as const) {
    db.insert(generationJobs)
      .values({
        ...original,
        id,
        status,
        remoteTaskId: null,
        rawResponse:
          status === 'download_failed'
            ? [{ data: Buffer.from('invalid media').toString('base64'), mime: 'video/mp4' }]
            : null,
      })
      .run();
  }
  let submissions = 0;
  let queries = 0;
  app.get(GenerationAdapters).adapters.set('openai-videos', {
    protocol: 'openai-videos',
    submit: () => {
      submissions++;
      throw new Error('禁止重投');
    },
    query(ctx, remoteId) {
      queries++;
      expect(ctx.baseUrl).toBe(baseUrl);
      expect(ctx.connection?.routes?.query).toBe('old/videos/{id}');
      expect(ctx.apiKey).toBe('original-key');
      expect(remoteId).toBe('remote-original');
      return Promise.resolve({
        status: 'failed',
        category: 'upstream',
        code: 'FINISHED',
        message: '已终结',
      });
    },
  });
  generation.requery(ids[7]);
  await expect
    .poll(() => ({
      status: generation.get(ids[7]).status,
      code: generation.get(ids[7]).errorCode,
      message: generation.get(ids[7]).errorMessage,
    }))
    .toEqual({ status: 'failed', code: 'FINISHED', message: '已终结' });
  expect({ submissions, queries }).toEqual({ submissions: 0, queries: 1 });
  await expect.poll(() => generation.get(ids[8]).status).toBe('failed');
  expect(generation.get(ids[9]).recoveryAction).toBe('none');
  await expect(generation.resubmit(ids[9])).rejects.toThrow('不能安全重发');
  expect(generation.get(ids[10]).recoveryAction).toBe('download');
  generation.requery(ids[10]);
  await expect.poll(() => generation.get(ids[10]).status).toBe('download_failed');
  expect({ submissions, queries }).toEqual({ submissions: 0, queries: 1 });
  generation.cancel(ids[7]);
  expect(() => repository.saveChannel({ apiKey: 'replacement' }, ids[0])).toThrow('历史任务仍需');
  generation.cancel(ids[9]);
  expect(() => repository.saveChannel({ apiKey: 'replacement' }, ids[0])).toThrow('历史任务仍需');
  generation.cancel(ids[10]);
  repository.listModels();
  expect(
    app
      .get(DatabaseService)
      .db.select()
      .from(channelModels)
      .where(eq(channelModels.id, ids[1]))
      .get(),
  ).toBeUndefined();
  expect(repository.credentials(ids[0]).apiKey).toBe('original-key');
  expect(generation.get(ids[7]).request.prompt).toBe('历史内容');
  repository.saveChannel({ apiKey: 'replacement' }, ids[0]);
  expect(
    (await readdir(join(directory, 'data'))).filter((name) => name.includes('.before-')),
  ).toEqual(backups);
  await app.close();
  closed = true;
});
it('旧 MiniMax 地址语义只在升级时固化，显式目标不做前缀改写', async () => {
  const { directory, sqlite } = await legacyDatabase();
  sqlite.exec(`INSERT INTO channels (id,name,api_format,base_url,header_names,enabled,created_at,updated_at) VALUES ('channel','旧渠道','openai-completions','https://example.test/anthropic','[]',1,'','');
    INSERT INTO channel_models (id,channel_id,upstream_model_id,display_name,kind,protocol,overrides_json,connection_json,enabled) VALUES
    ('tts','channel','speech-2.6-hd','语音','tts','minimax-t2a','{}','{}',1),
    ('video','channel','MiniMax-H3','视频','video','minimax-video-v2','{}','{"baseUrl":"https://example.test/explicit/v1"}',1)`);
  sqlite.close();
  const app = await createEngine(new EngineConfig('a'.repeat(64), directory, []));
  cleanups.push(() => app.close());
  await app.init();
  const repository = app.get(ChannelsRepository);
  expect(repository.getModel('tts').connection?.baseUrl).toBe('https://example.test');
  expect(repository.getModel('video').connection?.baseUrl).toBe('https://example.test/explicit/v1');
});
it('配置转换事务失败无部分绑定和清理，修复后可重入', async () => {
  const { directory, sqlite } = await legacyDatabase();
  sqlite.exec(`INSERT INTO channels (id,name,api_format,base_url,header_names,enabled,created_at,updated_at) VALUES ('channel','旧渠道','openai-completions','https://example.test/v1','[]',1,'','');
    INSERT INTO channel_models (id,channel_id,upstream_model_id,display_name,kind,protocol,overrides_json,connection_json,enabled) VALUES ('good','channel','gpt-4o','文本','chat','openai-completions','{}','{}',1), ('bad','channel','invalid','未知','tts','unsupported','{}','{}',1)`);
  sqlite.close();
  const app = await createEngine(new EngineConfig('a'.repeat(64), directory, []));
  cleanups.push(() => app.close());
  const catalog = app.get(ModelCatalogService);
  expect(() => catalog.onModuleInit()).toThrow();
  const db = app.get(DatabaseService).db;
  expect(
    db
      .select()
      .from(channelModels)
      .all()
      .map((model) => model.definitionId),
  ).toEqual([null, null]);
  expect(db.select().from(modelCatalog).all()).toEqual([]);
  db.delete(channelModels).where(eq(channelModels.id, 'bad')).run();
  catalog.onModuleInit();
  catalog.onModuleInit();
  expect(db.select().from(channelModels).all()[0].definitionId).toBe('openai-completions');
  expect(db.select().from(generationJobs).all()).toEqual([]);
});
