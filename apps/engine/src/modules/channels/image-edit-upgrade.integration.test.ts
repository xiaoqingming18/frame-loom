import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { expect, it } from 'vitest';
import { ModelProfile, ImageEditRecipe, imageEditCapabilityIssue } from '@frame-loom/contracts';
import { createEngine } from '../../application.js';
import { EngineConfig } from '../../core/config/config.js';
import { DatabaseService } from '../../core/database/database.service.js';
import { appMeta } from '../../core/database/app-meta.schema.js';
import { modelCatalog } from './channels.schema.js';
import { ChannelsRepository } from './channels.repository.js';
import { ModelCatalogService } from './model-catalog.service.js';
import { generationJobs } from '../generation/generation.schema.js';

it('旧内置目录带初始化标记安全补齐且幂等，显式限制、自定义和历史快照保持不变', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'loom-image-edit-upgrade-'));
  const app = await createEngine(new EngineConfig('a'.repeat(64), directory, [], 'b'.repeat(64)));
  try {
    await app.listen(0, '127.0.0.1');
    const database = app.get(DatabaseService);
    const db = database.db;
    const catalog = app.get(ModelCatalogService);
    const repository = app.get(ChannelsRepository);
    const current = catalog.get();
    const original = current.definitions.find((item) => item.id === 'openai-images-default')!;
    const old = structuredClone(original);
    delete old.profile.imageEditCapabilities;
    const custom = { ...old, id: 'custom-image' };
    const narrowed = structuredClone(
      current.definitions.find((item) => item.id === 'openai-images-gpt-image-2')!,
    );
    narrowed.profile.imageEditCapabilities = {
      operations: [],
      maxReferenceImages: 1,
      openAiImageEdit: false,
      mask: false,
    };
    const reducedInput = structuredClone(
      current.definitions.find((item) => item.id === 'gemini-image-default')!,
    );
    delete reducedInput.profile.imageEditCapabilities;
    reducedInput.profile.inputs = [
      { ...ModelProfile.parse(reducedInput.profile).inputs[0], maxCount: 0 },
    ];
    const legacy = {
      ...current,
      definitions: [
        ...current.definitions.map((item) => {
          if (item.id === old.id) return old;
          if (item.id === narrowed.id) return narrowed;
          if (item.id === reducedInput.id) return reducedInput;
          if (item.kind !== 'image') return item;
          const copy = structuredClone(item);
          delete copy.profile.imageEditCapabilities;
          return copy;
        }),
        custom,
      ],
    };
    db.update(modelCatalog).set({ package: legacy }).where(eq(modelCatalog.id, 'catalog')).run();
    db.delete(appMeta).where(eq(appMeta.key, 'image_edit_capabilities_v1')).run();
    expect(
      db.select().from(appMeta).where(eq(appMeta.key, 'model_bindings_v1')).get(),
    ).toBeDefined();
    const channel = repository.saveChannel({
      name: '临时旧目录',
      apiFormat: 'openai-completions',
      baseUrl: 'https://example.com/v1',
      apiKey: 'fixture-secret',
      enabled: true,
    });
    const model = repository.saveModel(channel.id, {
      definitionId: old.id,
      connectionId: 'openai-images',
      upstreamModelId: 'gpt-image-1',
      displayName: '旧图片模型',
      kind: 'image',
      protocol: 'openai-images',
      profileId: old.id,
      overrides: {},
      enabled: true,
    });
    const historical = {
      id: randomUUID(),
      channelModelId: model.id,
      profileId: old.id,
      kind: 'image' as const,
      profile: ModelProfile.parse(old.profile),
      status: 'succeeded' as const,
      request: {
        modelId: model.id,
        mode: 'text',
        prompt: '历史任务',
        params: {},
        inputs: [],
        source: 'test' as const,
      },
      snapshot: {
        version: 2 as const,
        channelId: channel.id,
        credentialFingerprint: 'frozen',
        baseUrl: 'https://example.com/v1',
        model: 'old-upstream',
        connection: { baseUrl: 'https://example.com/v1' },
        idempotencyKey: 'frozen',
        referenceUrls: {},
      },
      outputs: [],
      source: 'test' as const,
      deadlineAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    db.insert(generationJobs).values(historical).run();
    const beforeJob = db
      .select()
      .from(generationJobs)
      .where(eq(generationJobs.id, historical.id))
      .get();
    catalog.onModuleInit();
    const upgraded = catalog.get();
    expect(
      upgraded.definitions.find((item) => item.id === old.id)?.profile.imageEditCapabilities,
    ).toEqual(original.profile.imageEditCapabilities);
    expect(upgraded.definitions.find((item) => item.id === custom.id)).toEqual(custom);
    expect(upgraded.definitions.find((item) => item.id === narrowed.id)).toEqual(narrowed);
    expect(upgraded.definitions.find((item) => item.id === reducedInput.id)).toEqual(reducedInput);
    expect(upgraded.connections).toEqual(legacy.connections);
    expect(repository.getChannel(channel.id)).toEqual(channel);
    const backups = (await readdir(join(directory, 'data'))).filter((name) =>
      name.includes('before-image-edit'),
    );
    expect(backups).toHaveLength(1);
    catalog.onModuleInit();
    expect(catalog.get()).toEqual(upgraded);
    expect(
      (await readdir(join(directory, 'data'))).filter((name) => name.includes('before-image-edit')),
    ).toEqual(backups);
    expect(
      db.select().from(generationJobs).where(eq(generationJobs.id, historical.id)).get(),
    ).toEqual(beforeJob);
    const baseUrl = await app.getUrl();
    const response = await fetch(`${baseUrl}/channel-models`, {
      headers: { Authorization: `Bearer ${'a'.repeat(64)}` },
    });
    const models = (await response.json()) as { id: string; effectiveProfile: ModelProfile }[];
    const effective = models.find((item) => item.id === model.id)!.effectiveProfile;
    expect(effective.imageEditCapabilities).toEqual(original.profile.imageEditCapabilities);
    const recipe = ImageEditRecipe.parse({
      version: 1,
      source: { nodeId: 'source', sha256: 'a'.repeat(64) },
      operation: 'angle',
      horizontalAngle: 0,
      pitchAngle: 0,
      cameraDistance: 5,
      lens: 'standard',
    });
    expect(imageEditCapabilityIssue(recipe, effective)).toBeUndefined();
    const blockedModel = repository.saveModel(channel.id, {
      ...model,
      definitionId: narrowed.id,
      upstreamModelId: 'restricted',
    });
    const blockedProfile = repository.getModel(blockedModel.id).effectiveProfile!;
    const issue = imageEditCapabilityIssue(recipe, blockedProfile);
    expect(issue).toContain('已禁用');
    const rejected = await fetch(`${baseUrl}/generation-jobs`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${'a'.repeat(64)}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        modelId: blockedModel.id,
        mode: 'reference',
        prompt: '编辑',
        params: {},
        inputs: [{ kind: 'image', role: 'reference', sha256: recipe.source.sha256 }],
        imageEdit: recipe,
        source: 'test',
      }),
    });
    expect(rejected.status).toBe(422);
    expect(await rejected.text()).toContain(issue);
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});
