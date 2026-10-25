import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const protocols = [
  {
    name: 'openai-speech',
    env: 'FRAME_LOOM_SMOKE_OPENAI_SPEECH',
    path: '/audio/speech',
    build: (model, text) => ({
      model,
      input: text,
      voice: 'alloy',
      response_format: 'mp3',
      speed: 1,
    }),
  },
  {
    name: 'minimax-t2a',
    env: 'FRAME_LOOM_SMOKE_MINIMAX_T2A',
    path: '/v1/t2a_v2',
    build: (model, text) => ({
      model,
      text,
      stream: false,
      voice_setting: { voice_id: 'male-qn-qingse', speed: 1 },
      audio_setting: { format: 'mp3', sample_rate: 32000 },
    }),
  },
];
const results = [];
const directory = resolve(process.cwd(), '.cache');
await mkdir(directory, { recursive: true });
for (const protocol of protocols) {
  const prefix = protocol.env;
  const baseUrl = process.env[`${prefix}_BASE_URL`];
  const apiKey = process.env[`${prefix}_API_KEY`];
  const model = process.env[`${prefix}_MODEL`];
  if (!baseUrl || !apiKey || !model) {
    results.push({ protocol: protocol.name, skipped: '缺少 BASE_URL、API_KEY 或 MODEL 环境变量' });
    continue;
  }
  let safeBase;
  try {
    safeBase = new URL(baseUrl);
    if (!['https:', 'http:'].includes(safeBase.protocol) || safeBase.username || safeBase.password)
      throw new Error();
  } catch {
    results.push({ protocol: protocol.name, error: 'BASE_URL 必须是无凭据的 HTTP(S) 地址' });
    continue;
  }
  const startedAt = Date.now();
  try {
    const requestBase = new URL(safeBase);
    if (protocol.name === 'minimax-t2a')
      requestBase.pathname = requestBase.pathname.replace(/\/anthropic\/?$/, '');
    requestBase.pathname = `${requestBase.pathname.replace(/\/+$/, '')}/`;
    const response = await fetch(new URL(protocol.path.replace(/^\//, ''), requestBase), {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(180_000),
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(protocol.build(model, '你好。')),
    });
    const contentType = response.headers.get('content-type')?.split(';')[0] ?? 'unknown';
    const bytes = Number(response.headers.get('content-length')) || null;
    let fields = [];
    let usage = null;
    if (contentType.includes('json')) {
      const body = await response.json();
      fields = Object.keys(body ?? {}).filter(
        (key) => !/audio|data|content|url|key|token/i.test(key),
      );
      const audio = body?.data?.audio;
      if (typeof audio === 'string') {
        try {
          const decoded = Buffer.from(audio, 'hex');
          if (decoded.length) {
            const audioPath = resolve(
              directory,
              `provider-smoke-${protocol.name}-${new Date().toISOString().replaceAll(':', '-')}.mp3`,
            );
            await writeFile(audioPath, decoded, { mode: 0o600 });
          }
        } catch {
          /* 音频解析失败不写出原始响应内容。 */
        }
      }
      usage =
        body?.extra_info && typeof body.extra_info === 'object'
          ? Object.keys(body.extra_info).filter((key) =>
              /length|sample_rate|word|timestamp/i.test(key),
            )
          : null;
    } else {
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length && bytes.length <= 64 * 1024 * 1024) {
        const extension =
          contentType === 'audio/wav' ? 'wav' : contentType === 'audio/ogg' ? 'ogg' : 'mp3';
        const audioPath = resolve(
          directory,
          `provider-smoke-${protocol.name}-${new Date().toISOString().replaceAll(':', '-')}.${extension}`,
        );
        await writeFile(audioPath, bytes, { mode: 0o600 });
      }
    }
    results.push({
      protocol: protocol.name,
      ok: response.ok,
      status: response.status,
      elapsedMs: Date.now() - startedAt,
      contentType,
      bytes,
      responseFields: fields,
      usageFields: usage,
    });
  } catch (error) {
    results.push({
      protocol: protocol.name,
      ok: false,
      elapsedMs: Date.now() - startedAt,
      error: error?.name === 'TimeoutError' ? '请求超时' : '连接或响应失败',
    });
  }
}
const output = resolve(
  directory,
  `provider-smoke-${new Date().toISOString().replaceAll(':', '-')}.json`,
);
await writeFile(
  output,
  `${JSON.stringify({ createdAt: new Date().toISOString(), results }, null, 2)}\n`,
  { mode: 0o600 },
);
for (const result of results)
  console.log(
    `${result.protocol}: ${result.skipped ?? result.error ?? (result.ok ? '通过' : `HTTP ${result.status}`)}`,
  );
console.log(`结果：${output}`);
