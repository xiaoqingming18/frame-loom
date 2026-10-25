import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { GenerationFailure } from './types.js';
import { openaiSpeech, minimaxT2a } from './tts.js';

let server: Server;
let baseUrl = '';
const requests: { url?: string; authorization?: string; body: string }[] = [];
const mp3 = Buffer.from([0xff, 0xfb, 0x90, 0x64, 0, 0, 0, 0]);
let unauthorized = false;
beforeAll(async () => {
  server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      const body = Buffer.concat(chunks).toString();
      requests.push({ url: request.url, authorization: request.headers.authorization, body });
      if (unauthorized) {
        response.writeHead(401, { 'Content-Type': 'application/json' });
        response.end(
          JSON.stringify({
            error: { code: 'invalid_api_key', message: 'sk-secret must not escape' },
          }),
        );
      } else if (request.url === '/v1/t2a_v2') {
        response.setHeader('Content-Type', 'application/json');
        response.end(
          JSON.stringify({
            data: { audio: mp3.toString('hex') },
            extra_info: { audio_format: 'mp3' },
          }),
        );
      } else {
        response.setHeader('Content-Type', 'audio/mpeg');
        response.end(mp3);
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
});
afterAll(
  () =>
    new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    ),
);
const context = {
  baseUrl: '',
  apiKey: 'sk-test',
  headers: {},
  model: 'tts-model',
  signal: new AbortController().signal,
};
it('posts OpenAI speech JSON and returns audio bytes', async () => {
  const result = await openaiSpeech.submit(
    { ...context, baseUrl },
    {
      modelId: '00000000-0000-4000-8000-000000000000',
      mode: 'text',
      prompt: '你好',
      params: { voice: 'alloy', response_format: 'mp3', speed: 1 },
      inputs: [],
      source: 'manual',
    },
  );
  expect(result).toMatchObject({
    status: 'succeeded',
    outputs: [{ mime: 'audio/mpeg', data: mp3.toString('base64') }],
  });
  expect(requests.at(-1)).toMatchObject({
    url: '/v1/audio/speech',
    authorization: 'Bearer sk-test',
  });
  expect(JSON.parse(requests.at(-1)!.body)).toMatchObject({ input: '你好', voice: 'alloy' });
});
it('posts MiniMax T2A settings and decodes the hex audio payload', async () => {
  const result = await minimaxT2a.submit(
    { ...context, baseUrl: baseUrl.replace(/\/v1$/, '') },
    {
      modelId: '00000000-0000-4000-8000-000000000000',
      mode: 'text',
      prompt: '你好',
      params: { voice_id: 'male-qn-qingse', format: 'mp3', speed: 1, sample_rate: 32000 },
      inputs: [],
      source: 'manual',
    },
  );
  expect(result).toMatchObject({
    status: 'succeeded',
    outputs: [{ mime: 'audio/mpeg', data: mp3.toString('base64') }],
  });
  expect(requests.at(-1)).toMatchObject({ url: '/v1/t2a_v2' });
  expect(JSON.parse(requests.at(-1)!.body)).toMatchObject({
    text: '你好',
    voice_setting: { voice_id: 'male-qn-qingse', speed: 1 },
  });
});
it('classifies authentication failures without exposing the upstream body', async () => {
  unauthorized = true;
  try {
    const failure = openaiSpeech.submit(
      { ...context, baseUrl },
      {
        modelId: '00000000-0000-4000-8000-000000000000',
        mode: 'text',
        prompt: 'test',
        params: {},
        inputs: [],
        source: 'manual',
      },
    );
    try {
      await failure;
      throw new Error('应拒绝未授权请求');
    } catch (error) {
      expect(error).toBeInstanceOf(GenerationFailure);
      if (error instanceof GenerationFailure) {
        expect(error.category).toBe('auth');
        expect(error.code).toBe('invalid_api_key');
        expect(error.message).not.toContain('sk-secret');
      }
    }
  } finally {
    unauthorized = false;
  }
});
