import { expect, it } from 'vitest';
import { getProtocol } from '@frame-loom/contracts';
import { ModelWrite } from '@frame-loom/contracts';
import { testEngine } from '../../testing/test-engine.js';
import { ModelServicesRepository } from './model-services.repository.js';
import { VoicesService } from './voices.service.js';
import { mockUpstream } from '../../testing/mock-upstream.js';

it('音色按账号、协议与上游 ID 隔离，远端失败仍可手填，切换密钥失效', async () => {
  const upstream = await mockUpstream([
    {
      method: 'POST',
      path: '/v1/get_voice',
      headers: { authorization: 'Bearer account-one' },
      reply: () => ({ status: 500, body: 'private-error' }),
    },
  ]);
  const engine = await testEngine();
  try {
    const repo = engine.app.get(ModelServicesRepository);
    const voices = engine.app.get(VoicesService);
    const channels = ['account-one', 'account-two'].map((apiKey) =>
      repo.saveChannel({ name: apiKey, baseUrl: upstream.origin, apiKey, enabled: true }),
    );
    const make = (channelId: string, upstreamModelId: string, protocolId = 'minimax-t2a') =>
      repo.saveModels(channelId, [
        ModelWrite.parse({
          kind: 'tts',
          displayName: '语音',
          upstreamModelId,
          protocolId,
          capability: getProtocol(protocolId)!.templates.tts,
          enabled: true,
        }),
      ])[0];
    const first = make(channels[0].id, 'alias');
    const others = [
      make(channels[1].id, 'alias'),
      make(channels[0].id, 'other'),
      make(channels[0].id, 'alias', 'elevenlabs'),
    ];
    await expect(voices.fetch(first.id)).rejects.toThrow();
    expect(voices.save(first.id, { voiceId: 'manual-id', name: '手填音色' }).voices).toMatchObject([
      { voiceId: 'manual-id' },
    ]);
    for (const other of others) expect(voices.list(other.id).voices).toEqual([]);
    repo.saveChannel({ apiKey: 'changed-account' }, channels[0].id);
    expect(voices.list(first.id).voices).toEqual([]);
    expect(upstream.requests).toHaveLength(1);
    expect(upstream.violations).toEqual([]);
  } finally {
    await engine.close();
    await upstream.close();
  }
});
