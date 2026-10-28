import { describe, expect, it } from 'vitest';
import {
  Channel,
  ChannelWrite,
  ModelWrite,
  ModelExport,
  ServiceUrl,
  OverrideUrl,
  FixedField,
  ExtraParam,
} from './model-service.js';
import { PROTOCOLS } from './protocols.js';

describe('模型服务 schema', () => {
  it.each(PROTOCOLS)('$id 能力卡完整往返', (descriptor) => {
    for (const [kind, capability] of Object.entries(descriptor.templates)) {
      const model = ModelWrite.parse({
        kind,
        capability,
        protocolId: descriptor.id,
        upstreamModelId: 'model',
        displayName: '模型',
        enabled: false,
      });
      expect(ModelWrite.parse(JSON.parse(JSON.stringify(model)))).toEqual(model);
      expect(
        ModelWrite.safeParse({ ...model, capability: { ...capability, contextWindow: null } })
          .success,
      ).toBe(false);
    }
  });
  it('渠道读取拒绝凭据，写入区分缺省和清除', () => {
    const read = {
      id: '00000000-0000-4000-8000-000000000001',
      name: '渠道',
      baseUrl: 'https://a.test/v1',
      catalogFormat: 'openai',
      concurrency: 2,
      enabled: true,
      hasKey: true,
      keyHint: '••••test',
      hasSecretKey: false,
      headerNames: [],
      createdAt: '2026-10-28T00:00:00Z',
      updatedAt: '2026-10-28T00:00:00Z',
    };
    expect(Channel.parse(read)).toEqual(read);
    expect(Channel.safeParse({ ...read, apiKey: 'secret' }).success).toBe(false);
    const write = { name: ' 渠道 ', baseUrl: read.baseUrl, enabled: true };
    expect(ChannelWrite.parse(write).apiKey).toBeUndefined();
    expect(ChannelWrite.parse({ ...write, apiKey: '', secretKey: '', headers: {} })).toMatchObject({
      apiKey: '',
      secretKey: '',
      headers: {},
    });
    for (const key of ['Authorization', 'Host', 'Xi-Api-Key'])
      expect(ChannelWrite.safeParse({ ...write, headers: { [key]: 'secret' } }).success).toBe(
        false,
      );
  });
  it('导出拒绝凭据和主机确认，附加字段检查大小、类型和安全路径', () => {
    const model = ModelWrite.parse({
      kind: 'chat',
      capability: PROTOCOLS[0].templates.chat,
      protocolId: 'openai-chat',
      upstreamModelId: 'model',
      displayName: '模型',
      enabled: false,
    });
    const { enabled: _enabled, endpointOverride: _endpointOverride, ...fields } = model;
    expect(_enabled).toBe(false);
    expect(_endpointOverride).toEqual({ confirmedHosts: [] });
    const exported = {
      schema: 'frame-loom.model',
      schemaVersion: 1,
      model: { ...fields, endpointOverride: {} },
    };
    expect(ModelExport.safeParse(exported).success).toBe(true);
    for (const field of [
      { apiKey: 'secret' },
      { endpointOverride: { confirmedHosts: ['a.test'] } },
    ])
      expect(
        ModelExport.safeParse({ ...exported, model: { ...exported.model, ...field } }).success,
      ).toBe(false);
    expect(FixedField.safeParse({ path: '__proto__.polluted', value: true }).success).toBe(false);
    expect(FixedField.safeParse({ path: 'field', value: '中'.repeat(2000) }).success).toBe(false);
    expect(
      ExtraParam.safeParse({
        key: 'steps',
        label: '步数',
        type: 'number',
        default: 'bad',
        path: 'parameters.steps',
      }).success,
    ).toBe(false);
    expect(
      ModelWrite.safeParse({
        ...model,
        extras: [
          { key: 'x', label: 'x', type: 'string', path: 'x' },
          { key: 'x', label: 'x', type: 'string', path: 'y' },
        ],
      }).success,
    ).toBe(false);
    expect(
      ModelWrite.safeParse({
        ...model,
        fixedFields: [
          { path: 'x', value: 1 },
          { path: 'x', value: 2 },
        ],
      }).success,
    ).toBe(false);
  });
  it.each([
    'https://a.test/v1/chat/completions',
    'https://a.test/v1/models',
    'https://u:p@a.test',
    'ftp://a.test',
    'https://a.test?x=1',
    'https://a.test/#x',
  ])('拒绝非法服务根地址 %s', (value) => expect(ServiceUrl.safeParse(value).success).toBe(false));
  it('覆盖地址允许查询模板但拒绝未知占位符', () => {
    expect(OverrideUrl.safeParse('https://a.test/query?id={id}').success).toBe(true);
    expect(OverrideUrl.safeParse('https://a.test/{unknown}').success).toBe(false);
  });
});
