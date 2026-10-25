import { expect, it } from 'vitest';
import { Channel, ChannelWrite, ChannelModelWrite, TestChatRequest } from './models.js';

const channel = {
  name: '测试',
  apiFormat: 'openai-responses',
  baseUrl: 'https://example.com/v1',
  enabled: true,
};
it('写入允许凭据，拒绝非 HTTP 地址、内嵌凭据、查询参数及危险请求头', () => {
  expect(
    ChannelWrite.parse({ ...channel, apiKey: 'sk-secret', headers: { 'X-Project': 'test' } })
      .apiKey,
  ).toBe('sk-secret');
  for (const baseUrl of [
    'file:///c:/secret',
    'https://user:pass@example.com',
    'https://example.com?key=secret',
  ])
    expect(ChannelWrite.safeParse({ ...channel, baseUrl }).success).toBe(false);
  for (const headers of [{ Authorization: 'secret' }, { 'X-Test': 'a\r\nb' }])
    expect(ChannelWrite.safeParse({ ...channel, headers }).success).toBe(false);
});
it('读取 schema 严格拒绝任何明文凭据字段', () => {
  const read = {
    ...channel,
    id: 'd74b7618-95bb-48e5-a117-d859772926ec',
    hasKey: true,
    keyHint: '••••cret',
    headerNames: [],
    lastCheck: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  expect(Channel.parse(read)).toEqual(read);
  expect(Channel.safeParse({ ...read, apiFormat: 'openai' }).success).toBe(false);
  expect(Channel.safeParse({ ...read, apiKey: 'secret' }).success).toBe(false);
  expect(Channel.safeParse({ ...read, headers: { 'X-Secret': 'secret' } }).success).toBe(false);
});
it('允许未分类禁用模型，限制覆盖项和聊天边界', () => {
  const model = {
    upstreamModelId: 'unknown',
    displayName: '未知',
    kind: null,
    protocol: null,
    profileId: null,
    overrides: {},
    enabled: false,
  };
  expect(ChannelModelWrite.parse(model)).toEqual(model);
  expect(ChannelModelWrite.safeParse({ ...model, overrides: { maxTokens: -1 } }).success).toBe(
    false,
  );
  expect(TestChatRequest.safeParse({ modelId: 'bad', messages: [] }).success).toBe(false);
});
