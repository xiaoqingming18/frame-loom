import { afterEach, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createEngine } from '../../application.js';
import { EngineConfig } from '../../core/config/config.js';
import { ChannelsRepository } from '../channels/channels.repository.js';
import { VoicesService } from '../channels/voices.service.js';
import { GenerationService } from './generation.service.js';
import { MediaService } from './media.service.js';

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
function wav() {
  const bytes = Buffer.alloc(44 + 16000 * 2);
  bytes.write('RIFF');
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(16000, 24);
  bytes.writeUInt32LE(32000, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36);
  bytes.writeUInt32LE(bytes.length - 44, 40);
  return bytes;
}
async function setup() {
  const directory = await mkdtemp(join(tmpdir(), 'loom-tts-'));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const requests: { url: string; body: unknown }[] = [];
  let invalid = false;
  const server = createServer((req, res) => {
    void (async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of req as AsyncIterable<Buffer>) chunks.push(chunk);
      requests.push({ url: req.url!, body: JSON.parse(Buffer.concat(chunks).toString()) });
      if (req.url === '/tenant/anthropic/v1/get_voice') {
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify({
            base_resp: { status_code: 0 },
            system_voice: [{ voice_id: 'private', voice_name: '账号音色' }],
          }),
        );
      } else if (req.url === '/tenant/anthropic/speak') {
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify({
            data: { audio: (invalid ? Buffer.from('{"error":"bad"}') : wav()).toString('hex') },
            extra_info: { audio_format: 'mp3', audio_length: 999999 },
          }),
        );
      } else if (req.url === '/tenant/anthropic/audio/speech') {
        res.setHeader('Content-Type', 'audio/mpeg');
        res.end(wav());
      } else res.writeHead(404).end();
    })().catch(() => res.writeHead(500).end());
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  cleanups.push(
    () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  );
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/tenant/anthropic`;
  const app = await createEngine(new EngineConfig('a'.repeat(64), directory, [], 'b'.repeat(64)));
  await app.init();
  cleanups.push(() => app.close());
  const channels = app.get(ChannelsRepository);
  const channel = channels.saveChannel({
    name: 'TTS',
    apiFormat: 'openai-completions',
    baseUrl,
    apiKey: 'sk-a',
    enabled: true,
  });
  const model = channels.saveModel(channel.id, {
    upstreamModelId: 'speech-2.6-hd',
    displayName: '语音',
    kind: 'tts',
    protocol: 'minimax-t2a',
    profileId: null,
    enabled: true,
    overrides: {},
    connection: { contractVersion: 'v1', baseUrl, routes: { submit: 'speak' } },
  });
  return {
    app,
    channels,
    channel,
    model,
    requests,
    setInvalid: () => {
      invalid = true;
    },
  };
}
it('音色按凭据账号、协议和精确型号隔离；目录按有效地址拉取且失败不影响手填', async () => {
  const { app, channels, channel, model, requests } = await setup();
  const voices = app.get(VoicesService);
  expect(voices.list(model.id)).toMatchObject({ canManual: true, voices: [] });
  voices.save(model.id, { voiceId: 'private', name: '我的音色' });
  expect(voices.list(model.id).voices).toHaveLength(1);
  expect((await voices.fetch(model.id)).voices).toContainEqual({
    voiceId: 'private',
    name: '账号音色',
    source: 'provider',
  });
  expect(requests.at(-1)).toEqual({
    url: '/tenant/anthropic/v1/get_voice',
    body: { voice_type: 'all' },
  });
  channels.saveChannel({ apiKey: 'sk-b' }, channel.id);
  expect(voices.list(model.id).voices).toEqual([]);
  channels.saveChannel({ apiKey: 'sk-a' }, channel.id);
  const saved = voices.list(model.id).voices[0];
  voices.remove(model.id, saved.id!);
  expect(voices.list(model.id).voices).toEqual([]);
  const older = channels.saveModel(channel.id, {
    upstreamModelId: 'tts-1',
    displayName: '旧版',
    kind: 'tts',
    protocol: 'openai-speech',
    profileId: null,
    enabled: true,
    overrides: {},
  });
  expect(voices.list(older.id).voices.map((voice) => voice.voiceId)).not.toContain('coral');
  expect(() => voices.save(older.id, { voiceId: 'coral', name: '不兼容' })).toThrow('音色不在');
});
it('TTS 测试归档真实 WAV、时长、采样率和声道，保留用量及配置版本，错误封装不入库', async () => {
  const { app, model, requests, setInvalid } = await setup();
  const generation = app.get(GenerationService);
  const request = {
    modelId: model.id,
    mode: 'text',
    prompt: '你好',
    params: { voice_id: 'private', format: 'mp3', speed: 1 },
    inputs: [],
    source: 'test' as const,
  };
  const created = await generation.create(request);
  await expect.poll(() => generation.get(created.id).status).toBe('succeeded');
  const job = generation.get(created.id);
  expect(job.configVersion).toMatch(/^[a-f0-9]{64}$/);
  expect(job).toMatchObject({
    usage: { audio_length: 999999 },
    request: { source: 'test' },
    outputs: [
      {
        mime: 'audio/wav',
        durationMs: 1000,
        sampleRate: 16000,
        channels: 1,
        audioCodec: 'pcm_s16le',
      },
    ],
  });
  expect(requests.at(-1)).toMatchObject({
    url: '/tenant/anthropic/speak',
    body: { voice_setting: { voice_id: 'private', speed: 1 } },
  });
  setInvalid();
  const bad = await generation.create(request);
  await expect.poll(() => generation.get(bad.id).status).toBe('download_failed');
  expect(generation.get(bad.id).outputs).toEqual([]);
  const media = app.get(MediaService);
  await expect(
    media.saveStream([Buffer.from([0xff, 0xfb, 0, 0])], undefined, 'audio', 'audio/mpeg'),
  ).rejects.toThrow('无法探测');
});

it('OpenAI 二进制语音同样探测真实音频，不伪造用量，缺音色在提交前拒绝', async () => {
  const { app, channels, channel, model, requests } = await setup();
  const openai = channels.saveModel(channel.id, {
    upstreamModelId: 'tts-1',
    displayName: 'OpenAI 语音',
    kind: 'tts',
    protocol: 'openai-speech',
    profileId: null,
    enabled: true,
    overrides: {},
    connection: { contractVersion: 'v1', baseUrl: model.connection?.baseUrl },
  });
  const generation = app.get(GenerationService);
  const request = {
    modelId: openai.id,
    mode: 'text',
    prompt: '你好',
    params: { voice: 'alloy', response_format: 'mp3' },
    inputs: [],
    source: 'test' as const,
  };
  const job = await generation.create(request);
  await expect.poll(() => generation.get(job.id).status).toBe('succeeded');
  expect(generation.get(job.id)).toMatchObject({
    usage: null,
    outputs: [{ mime: 'audio/wav', durationMs: 1000, sampleRate: 16000, channels: 1 }],
  });
  expect(requests.at(-1)).toMatchObject({
    url: '/tenant/anthropic/audio/speech',
    body: { model: 'tts-1', voice: 'alloy', response_format: 'mp3' },
  });
  await expect(generation.create({ ...request, params: { voice: 'coral' } })).rejects.toThrow(
    '音色取值无效',
  );
  await expect(
    generation.create({ ...request, modelId: model.id, params: { voice_id: '' } }),
  ).rejects.toThrow('请选择或填写音色');
  expect(requests).toHaveLength(1);
});
