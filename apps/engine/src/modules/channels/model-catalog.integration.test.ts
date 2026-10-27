import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { ModelImportPackage, sevenVideoModelIds } from '@frame-loom/contracts';
import { createEngine } from '../../application.js';
import { EngineConfig } from '../../core/config/config.js';
import { ChannelsRepository } from './channels.repository.js';
import { ModelCatalogService } from './model-catalog.service.js';

it('目录可扩展、预览不落库、更新须确认，失效预览与跨账号绑定拒绝且失败整批回滚', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'loom-catalog-'));
  const app = await createEngine(new EngineConfig('a'.repeat(64), directory, [], 'b'.repeat(64)));
  try {
    const catalog = app.get(ModelCatalogService);
    const repository = app.get(ChannelsRepository);
    const channel = repository.saveChannel({
      name: '目录',
      apiFormat: 'openai-completions',
      baseUrl: 'https://example.com/v1',
      apiKey: 'secret',
      enabled: true,
    });
    const before = catalog.get();
    expect(
      before.definitions.filter((item) => item.kind === 'video').map((item) => item.id),
    ).toEqual(expect.arrayContaining([...sevenVideoModelIds]));
    for (const definition of before.definitions) {
      expect(() =>
        catalog.resolve({
          definitionId: definition.id,
          connectionId: definition.protocol,
          upstreamModelId: 'fixture',
          displayName: 'fixture',
          kind: null,
          protocol: null,
          profileId: null,
          overrides: {},
          enabled: true,
        }),
      ).not.toThrow();
    }
    const incoming = ModelImportPackage.parse({
      ...before,
      definitions: [{ ...before.definitions[0], id: 'custom-chat', name: '新增文本' }],
      connections: [{ ...before.connections[0], id: 'custom-service', credentialRef: channel.id }],
      bindings: [
        {
          channelId: channel.id,
          modelDefinitionId: 'custom-chat',
          connectionId: 'custom-service',
          upstreamModelId: 'new-chat',
        },
      ],
    });
    const preview = catalog.preview(incoming);
    expect(repository.listModels()).toHaveLength(0);
    expect(catalog.get()).toEqual(before);
    catalog.apply(incoming, preview.revision, false);
    const model = repository.listModels()[0];
    expect(model.connection?.credentialRef).toBe(channel.id);
    repository.saveDefaults({ chat: model.id });
    const updated = {
      ...incoming,
      definitions: [{ ...incoming.definitions[0], name: '改名' }],
      bindings: [{ ...incoming.bindings[0], id: model.id }],
    };
    const changes = catalog.preview(updated);
    expect(changes.affectedModels).toContain(model.displayName);
    expect(() => catalog.apply(updated, changes.revision, false)).toThrow();
    catalog.apply(updated, changes.revision, true);
    expect(repository.defaults().chat).toBe(model.id);
    const stale = catalog.preview(updated);
    repository.updateModel(model.id, { ...model, displayName: '稍后修改' });
    expect(() => catalog.apply(updated, stale.revision, true)).toThrow();
    const other = repository.saveChannel({
      name: '其他账号',
      apiFormat: 'openai-completions',
      baseUrl: 'https://example.com',
      enabled: true,
    });
    expect(() =>
      catalog.preview({ ...updated, bindings: [{ ...updated.bindings[0], channelId: other.id }] }),
    ).toThrow();
    expect(() => catalog.preview({ ...incoming, apiKey: 'leak' })).toThrow();
    expect(() =>
      catalog.preview({
        ...incoming,
        definitions: [
          {
            ...incoming.definitions[0],
            operations: [{ id: 'generate', status: 'supported', input: { prompt: 'unsupported' } }],
          },
        ],
      }),
    ).toThrow();
    expect(() =>
      catalog.preview({
        ...incoming,
        definitions: [{ ...incoming.definitions[0], kind: 'image', protocol: 'openai-images' }],
      }),
    ).toThrow();
    expect(() =>
      catalog.preview({ ...incoming, requires: [{ name: 'unknown', version: 'v1' }] }),
    ).toThrow();
    expect(() =>
      catalog.preview({
        ...incoming,
        connections: [{ ...incoming.connections[0], baseUrl: 'http://127.0.0.1' }],
      }),
    ).toThrow();
    const rollback = {
      ...incoming,
      definitions: [{ ...incoming.definitions[0], name: '不应留下' }],
      bindings: [incoming.bindings[0], incoming.bindings[0]],
    };
    const rollbackPreview = catalog.preview(rollback);
    const savedCatalog = catalog.get();
    expect(() => catalog.apply(rollback, rollbackPreview.revision, true)).toThrow();
    expect(catalog.get()).toEqual(savedCatalog);
    expect(repository.listModels()).toHaveLength(1);
    expect(repository.getModel(model.id).displayName).toBe('稍后修改');
    expect(() => catalog.resolve({ ...model, overrides: { concurrency: 16 } })).toThrow();
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});
