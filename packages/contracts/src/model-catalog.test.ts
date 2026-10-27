import { expect, it } from 'vitest';
import {
  MappingDefinition,
  ModelBinding,
  ModelImportPackage,
  ServiceConnectionDefinition,
  validateMapping,
} from './model-catalog.js';

it('只允许无密钥的分层接入和跨渠道显式绑定', () => {
  const connection = ServiceConnectionDefinition.parse({
    id: 'kling-api',
    version: 'v1',
    name: 'Kling',
    protocol: 'kling-video',
    baseUrl: 'https://api.example.test/v1',
    credentialRef: 'channel-key',
    operations: ['submit', 'query'],
  });
  expect(connection.credentialRef).toBe('channel-key');
  expect(ServiceConnectionDefinition.safeParse({ ...connection, apiKey: 'secret' }).success).toBe(
    false,
  );
  expect(() =>
    ModelBinding.parse({
      channelId: crypto.randomUUID(),
      connectionId: 'missing',
      modelDefinitionId: 'kling-4.0',
      upstreamModelId: 'kling-v4',
    }),
  ).not.toThrow();
});

it('限制有限映射和导入包的敏感字段', () => {
  const mapping = MappingDefinition.parse({
    version: 'v1',
    rules: [{ type: 'constant', to: 'duration', value: 5 }],
  });
  expect(validateMapping(mapping).rules).toHaveLength(1);
  expect(
    MappingDefinition.safeParse({
      version: 'v1',
      rules: [{ type: 'constant', to: 'x', value: { script: 'eval()' } }],
    }).success,
  ).toBe(false);
  expect(
    ModelImportPackage.safeParse({
      schema: 'frame-loom.model-package',
      schemaVersion: 1,
      source: 'local',
      definitions: [],
      apiKey: 'secret',
    }).success,
  ).toBe(false);
});
