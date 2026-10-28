import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { protocolContext, semanticRequest, httpResult } from '../../../testing/protocol-context.js';
import { mockUpstream } from '../../../testing/mock-upstream.js';
import { probeMedia } from '../media-probe.js';
import { openaiSpeech } from './openai-speech.js';
import { minimaxT2a } from './minimax-t2a.js';
import { elevenlabs } from './elevenlabs.js';
import { geminiGenerate } from './gemini-generate.js';
import { audioResult, binaryAudio, pcmWav } from './audio.js';
import type { HttpResult } from './types.js';

const pcm = Buffer.alloc(4800);
const wav = pcmWav(pcm);
function binary(bytes = wav, mime = 'audio/wav'): HttpResult {
  return { status: 200, headers: new Headers({ 'content-type': mime }), bytes };
}
describe('TTS 协议契约', () => {
  it('Gemini 多说话人由固定 JSON 配置且受能力卡人数上限约束', async () => {
    const ctx = protocolContext(geminiGenerate.descriptor, 'tts');
    const multi = {
      speakerVoiceConfigs: ['甲', '乙'].map((speaker) => ({
        speaker,
        voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } },
      })),
    };
    ctx.snapshot.fixedFields = [
      { path: 'generationConfig.speechConfig.multiSpeakerVoiceConfig', value: multi },
    ];
    const call = await geminiGenerate.buildSubmit(
      ctx,
      semanticRequest(ctx),
      ctx.snapshot.capability,
    );
    expect(JSON.parse(call.body as string)).toMatchObject({
      generationConfig: { speechConfig: { multiSpeakerVoiceConfig: multi } },
    });
    multi.speakerVoiceConfigs.push(multi.speakerVoiceConfigs[0]);
    await expect(
      geminiGenerate.buildSubmit(ctx, semanticRequest(ctx), ctx.snapshot.capability),
    ).rejects.toMatchObject({ code: 'INVALID_SPEAKERS' });
  });
  it('MiniMax PCM hex 按响应采样率封装 WAV', async () => {
    const ctx = protocolContext(minimaxT2a.descriptor, 'tts');
    const result = await minimaxT2a.parseSubmit(
      ctx,
      httpResult({
        base_resp: { status_code: 0 },
        data: { audio: pcm.toString('hex') },
        extra_info: { audio_format: 'pcm', audio_sample_rate: 32000, audio_size: pcm.length },
      }),
    );
    expect(result.status).toBe('succeeded');
    if (result.status === 'succeeded' && result.outputs[0].kind === 'data')
      expect(Buffer.from(result.outputs[0].base64, 'base64').readUInt32LE(24)).toBe(32000);
  });
  it('OpenAI 明确翻译语义字段，二进制与 PCM 返回不修改快照', async () => {
    const ctx = protocolContext(openaiSpeech.descriptor, 'tts');
    const snapshot = structuredClone(ctx.snapshot);
    const call = await openaiSpeech.buildSubmit(
      ctx,
      semanticRequest(ctx, {
        params: { voice: 'coral', instructions: '轻声', speed: 1.2, format: 'pcm' },
      }),
      ctx.snapshot.capability,
    );
    expect(JSON.parse(call.body as string)).toEqual({
      model: 'arbitrary-model',
      input: '测试',
      voice: 'coral',
      instructions: '轻声',
      speed: 1.2,
      response_format: 'pcm',
    });
    expect(ctx.snapshot).toEqual(snapshot);
    expect(await openaiSpeech.parseSubmit(ctx, binary())).toMatchObject({
      status: 'succeeded',
      outputs: [{ mime: 'audio/wav' }],
    });
    expect(
      binaryAudio({
        ...binary(pcm, 'application/octet-stream'),
        responseAudio: call.responseAudio,
      }),
    ).toMatchObject({
      status: 'succeeded',
      outputs: [{ base64: Buffer.from(wav).toString('base64') }],
    });
  });
  it('MiniMax 请求体与 hex 音频、业务失败、损坏音频', async () => {
    const ctx = protocolContext(minimaxT2a.descriptor, 'tts');
    const call = await minimaxT2a.buildSubmit(
      ctx,
      semanticRequest(ctx, {
        params: {
          voice: 'manual',
          speed: 1.1,
          pitch: 2,
          volume: 1,
          sampleRate: 24000,
          format: 'wav',
        },
      }),
      ctx.snapshot.capability,
    );
    expect(JSON.parse(call.body as string)).toMatchObject({
      stream: false,
      output_format: 'hex',
      voice_setting: { voice_id: 'manual', speed: 1.1, pitch: 2, vol: 1 },
      audio_setting: { sample_rate: 24000, format: 'wav', channel: 1 },
    });
    const result = (audio: string, size = wav.length) =>
      httpResult({
        base_resp: { status_code: 0 },
        data: { audio },
        extra_info: { audio_format: 'wav', audio_size: size },
      });
    expect(
      await minimaxT2a.parseSubmit(ctx, result(Buffer.from(wav).toString('hex'))),
    ).toMatchObject({ status: 'succeeded' });
    for (const hex of ['abc', 'gg', Buffer.from(wav).subarray(0, 45).toString('hex')])
      expect(() => minimaxT2a.parseSubmit(ctx, result(hex))).toThrow();
    expect(
      await minimaxT2a.parseSubmit(ctx, httpResult({ base_resp: { status_code: 1000 } })),
    ).toMatchObject({ status: 'failed', code: 'TTS_FAILED' });
  });
  it('ElevenLabs voice 路径转义、输出格式和 PCM 采样率', async () => {
    const ctx = protocolContext(elevenlabs.descriptor, 'tts');
    const call = await elevenlabs.buildSubmit(
      ctx,
      semanticRequest(ctx, { params: { voice: 'voice id', format: 'pcm_44100' } }),
      ctx.snapshot.capability,
    );
    expect(call.url).toBe(
      'http://127.0.0.1:12345/gateway/v1/text-to-speech/voice%20id?output_format=pcm_44100',
    );
    expect(ctx.snapshot.endpoints.voices?.url).toBe('http://127.0.0.1:12345/gateway/v2/voices');
    const result = await elevenlabs.parseSubmit(ctx, {
      ...binary(pcm, 'application/octet-stream'),
      responseAudio: call.responseAudio,
    });
    expect(result.status).toBe('succeeded');
    if (result.status === 'succeeded' && result.outputs[0].kind === 'data')
      expect(Buffer.from(result.outputs[0].base64, 'base64').readUInt32LE(24)).toBe(44100);
  });
  it('Gemini base64 PCM 包装后 ffprobe 检出 24kHz 单声道，也接受 WAV', async () => {
    const ctx = protocolContext(geminiGenerate.descriptor, 'tts');
    const call = await geminiGenerate.buildSubmit(
      ctx,
      semanticRequest(ctx, { params: { instructions: '平静' } }),
      ctx.snapshot.capability,
    );
    expect(JSON.parse(call.body as string)).toMatchObject({
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } },
      },
    });
    const response = (data: Uint8Array, mimeType: string) =>
      httpResult({
        candidates: [
          {
            content: {
              parts: [{ inlineData: { data: Buffer.from(data).toString('base64'), mimeType } }],
            },
          },
        ],
      });
    const result = await geminiGenerate.parseSubmit(
      ctx,
      response(pcm, 'audio/L16;codec=pcm;rate=24000'),
    );
    expect(result.status).toBe('succeeded');
    const directory = await mkdtemp(join(tmpdir(), 'loom-tts-'));
    try {
      if (result.status !== 'succeeded' || result.outputs[0].kind !== 'data')
        throw new Error('缺少音频');
      const path = join(directory, 'result.wav');
      await writeFile(path, Buffer.from(result.outputs[0].base64, 'base64'));
      expect(await probeMedia(path)).toMatchObject({
        sampleRate: 24000,
        channels: 1,
        mime: 'audio/wav',
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
    expect(await geminiGenerate.parseSubmit(ctx, response(wav, 'audio/wav'))).toMatchObject({
      status: 'succeeded',
    });
    expect(() => geminiGenerate.parseSubmit(ctx, response(pcm, 'audio/L16;rate=16000'))).toThrow();
  });
  it('拒绝 JSON 错误体、短音频、奇数 PCM 和截断 WAV', () => {
    expect(() =>
      binaryAudio(binary(Buffer.from('{"error":"secret"}'), 'application/json')),
    ).toThrow();
    expect(() => audioResult(new Uint8Array(4), 'audio/mpeg')).toThrow();
    expect(() => pcmWav(new Uint8Array(3))).toThrow();
    expect(() => audioResult(wav.subarray(0, 100), 'audio/wav')).toThrow();
  });
  it('音色目录只访问文档路径，MiniMax 合并来源，ElevenLabs 分页', async () => {
    const upstream = await mockUpstream([
      {
        method: 'POST',
        path: '/v1/get_voice',
        headers: { authorization: 'Bearer test-key' },
        reply: (req) => {
          expect(JSON.parse(req.body)).toEqual({ voice_type: 'all' });
          return {
            body: JSON.stringify({
              base_resp: { status_code: 0 },
              system_voice: [{ voice_id: 'system' }],
              voice_cloning: [{ voice_id: 'clone', voice_name: '克隆' }],
              voice_generation: [{ voice_id: 'generated' }],
            }),
          };
        },
      },
      {
        method: 'GET',
        path: '/v2/voices?page_size=100',
        headers: { 'xi-api-key': 'test-key' },
        reply: () => ({
          body: JSON.stringify({
            voices: [{ voice_id: 'one', name: '一' }],
            has_more: true,
            next_page_token: 'second',
          }),
        }),
      },
      {
        method: 'GET',
        path: '/v2/voices?page_size=100&next_page_token=second',
        headers: { 'xi-api-key': 'test-key' },
        reply: () => ({
          body: JSON.stringify({ voices: [{ voice_id: 'two', name: '二' }], has_more: false }),
        }),
      },
    ]);
    try {
      for (const adapter of [minimaxT2a, elevenlabs]) {
        const ctx = protocolContext(adapter.descriptor, 'tts');
        ctx.snapshot.endpoints.voices!.url =
          upstream.origin + (adapter === minimaxT2a ? '/v1/get_voice' : '/v2/voices');
        const voices = await adapter.listVoices!(ctx);
        expect(voices.map((voice) => voice.id)).toEqual(
          adapter === minimaxT2a ? ['system', 'clone', 'generated'] : ['one', 'two'],
        );
      }
      expect(upstream.requests).toHaveLength(3);
      expect(upstream.violations).toEqual([]);
    } finally {
      await upstream.close();
    }
  });
});
