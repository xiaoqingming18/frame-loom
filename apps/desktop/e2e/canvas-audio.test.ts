import { expect, test, _electron, type ElectronApplication } from '@playwright/test';
import { Model, GenerationJob, getProtocol } from '@frame-loom/contracts';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { addMediaChannel, addMediaModel, disposeTestApp, engineApi } from './model-service.fixture';
import { openProjectCanvas } from './project-canvas.fixture';

test('音频节点生成 PCM、播放、参考视频与重启保留', async ({}, info) => {
  test.setTimeout(150_000);
  const pcm = Buffer.alloc(144000);
  const video = await readFile(
    new URL(
      '../../engine/src/modules/generation/protocols/fixtures/reference.mp4',
      import.meta.url,
    ),
  );
  const requests: { path: string; body: Record<string, unknown> }[] = [];
  const uploads: Buffer[] = [];
  let invalid = 0;
  const server = createServer((request, response) => {
    const path = request.url ?? '';
    if (request.method === 'GET' && path === '/result.mp4') {
      expect(request.headers.authorization).toBeUndefined();
      response.writeHead(200, { 'Content-Type': 'video/mp4' }).end(video);
      return;
    }
    if (request.method === 'PUT' && /^\/bucket\/audio\/[a-f0-9]{64}\.wav$/.test(path)) {
      if (
        !request.headers.authorization?.startsWith('AWS4-HMAC-SHA256 Credential=local-storage/')
      ) {
        invalid++;
        response.writeHead(401).end();
        return;
      }
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        uploads.push(Buffer.concat(chunks));
        response.writeHead(200).end();
      });
      return;
    }
    const tts = request.method === 'POST' && path === '/v1beta/models/local-tts:generateContent';
    const submit = request.method === 'POST' && path === '/api/v3/contents/generations/tasks';
    const query =
      request.method === 'GET' && path === '/api/v3/contents/generations/tasks/audio-video';
    if (!tts && !submit && !query) {
      invalid++;
      response.writeHead(404).end();
      return;
    }
    if (
      tts
        ? request.headers['x-goog-api-key'] !== 'fixture-local'
        : request.headers.authorization !== 'Bearer fixture-local'
    ) {
      invalid++;
      response.writeHead(401).end();
      return;
    }
    response.setHeader('Content-Type', 'application/json');
    if (query) {
      response.end(
        JSON.stringify({
          id: 'audio-video',
          status: 'succeeded',
          content: { video_url: remote + '/result.mp4' },
        }),
      );
      return;
    }
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk: string) => {
      body += chunk;
    });
    request.on('end', () => {
      requests.push({ path, body: JSON.parse(body) as Record<string, unknown> });
      response.end(
        JSON.stringify(
          tts
            ? {
                candidates: [
                  {
                    content: {
                      parts: [
                        {
                          inlineData: {
                            mimeType: 'audio/L16;codec=pcm;rate=24000',
                            data: pcm.toString('base64'),
                          },
                        },
                      ],
                    },
                    finishReason: 'STOP',
                  },
                ],
              }
            : { id: 'audio-video' },
        ),
      );
    });
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const remote = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const userData = await mkdtemp(join(tmpdir(), 'loom-canvas-audio-'));
  const desktop = resolve(fileURLToPath(new URL('..', import.meta.url)));
  let app: ElectronApplication | undefined;
  try {
    app = await _electron.launch({
      args: [
        resolve(desktop, 'e2e/fixtures/local-storage-main.cjs'),
        `--user-data-dir=${userData}`,
      ],
      env: { ...process.env, FRAME_LOOM_MOCK_STORAGE: remote },
    });
    let page = await app.firstWindow();
    await expect(page.getByRole('heading', { name: '帧织' })).toBeVisible();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1500, 960));
    const channel = await addMediaChannel(page, remote, 'fixture-local');
    const protocol = getProtocol('gemini-generate')!;
    const tts = Model.array().parse(
      await engineApi(page, `/channels/${channel.id}/models`, 'POST', [
        {
          kind: 'tts',
          protocolId: protocol.id,
          upstreamModelId: 'local-tts',
          displayName: '本地语音',
          enabled: true,
          capability: protocol.templates.tts,
        },
      ]),
    )[0];
    await addMediaModel(page, channel.id, 'ark-seedance', '本地视频');
    await engineApi(page, '/object-storage', 'PUT', {
      endpoint: 'http://8.8.8.8',
      region: 'local',
      bucket: 'bucket',
      accessKeyId: 'local-storage',
      secretAccessKey: 'fixture-storage',
      keyPrefix: 'audio',
    });
    await openProjectCanvas(page, app);
    const editor = page.getByRole('region', { name: '画布编辑区' });
    const add = async (label: string, x: number) => {
      await editor.focus();
      await page.keyboard.press('Escape');
      const box = (await editor.boundingBox())!;
      await page.mouse.dblclick(box.x + x, box.y + 180);
      await page.getByRole('menuitem', { name: label, exact: true }).click();
    };
    await add('音频', 300);
    await page.getByLabel('生成提示词').fill('你好，帧织。');
    await page.getByRole('button', { name: '生成参数', exact: true }).click();
    await page.getByRole('combobox', { name: '音色', exact: true }).selectOption('Kore');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: '生成音频', exact: true }).click();
    const audio = page.locator('.react-flow__node-audio audio');
    await expect(audio).toBeVisible();
    await expect
      .poll(() => audio.evaluate((element: HTMLAudioElement) => element.duration))
      .toBeGreaterThan(0);
    await audio.evaluate((element: HTMLAudioElement) => element.play());
    expect(requests.filter((item) => item.path.includes('generateContent'))).toHaveLength(1);
    expect(requests[0].body).toMatchObject({
      generationConfig: {
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } },
      },
    });
    for (const theme of ['light', 'dark'] as const) {
      await page.evaluate(`window.frameLoom.theme.set('${theme}')`);
      await page.emulateMedia({ colorScheme: theme });
      await expect(page.locator('body')).toHaveCSS(
        'background-color',
        theme === 'dark' ? 'rgb(13, 13, 15)' : 'rgb(246, 247, 249)',
      );
      await page.screenshot({
        path: info.outputPath(`audio-${theme}.png`),
        animations: 'disabled',
      });
      await page.getByRole('button', { name: '生成参数', exact: true }).click();
      await expect(page.getByRole('combobox', { name: '音色', exact: true })).toBeVisible();
      await page.keyboard.press('Tab');
      await page.screenshot({
        path: info.outputPath(`audio-params-${theme}.png`),
        animations: 'disabled',
      });
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: '折叠侧栏', exact: true }).click();
      await page.setViewportSize({ width: 800, height: 800 });
      await page.getByRole('button', { name: '生成参数', exact: true }).click();
      const panel = page.getByLabel('生成参数', { exact: true }).last();
      const bounds = (await panel.boundingBox())!;
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(800);
      await page.screenshot({
        path: info.outputPath(`audio-params-${theme}-800.png`),
        animations: 'disabled',
      });
      await page.keyboard.press('Escape');
      await page.setViewportSize({ width: 1500, height: 960 });
      await page.getByRole('button', { name: '展开侧栏', exact: true }).click();
    }
    await add('视频', 800);
    await page.getByRole('radio', { name: '全模态参考', exact: true }).click();
    await page.getByRole('button', { name: '添加参考素材', exact: true }).click();
    await page.getByRole('button', { name: '选择 音频', exact: true }).click();
    await expect(page.locator('.react-flow__edge')).toHaveCount(1);
    await page.getByLabel('生成提示词').fill('跟随参考音频生成画面');
    await page.getByRole('button', { name: '生成视频', exact: true }).click();
    await expect
      .poll(async () =>
        GenerationJob.array()
          .parse(await engineApi(page, '/generation-jobs'))
          .filter((job) => job.kind === 'video')
          .map((job) => ({ status: job.status, error: job.errorMessage })),
      )
      .toEqual([{ status: 'succeeded', error: null }]);
    await expect(page.locator('.react-flow__node-video video')).toBeVisible();
    const submission = requests.find((item) => item.path === '/api/v3/contents/generations/tasks')!;
    expect(submission.body).toMatchObject({
      content: [{ type: 'text' }, { type: 'audio_url', role: 'reference_audio' }],
    });
    expect(JSON.stringify(submission.body)).toContain('http://8.8.8.8/bucket/audio/');
    expect(uploads).toHaveLength(1);
    expect(uploads[0].subarray(0, 4).toString()).toBe('RIFF');
    expect(invalid).toBe(0);
    await expect(page.getByRole('status', { name: '画布保存状态' })).toHaveText('已保存');
    await app.close();
    app = await _electron.launch({
      args: [
        resolve(desktop, 'e2e/fixtures/local-storage-main.cjs'),
        `--user-data-dir=${userData}`,
      ],
      env: { ...process.env, FRAME_LOOM_MOCK_STORAGE: remote },
    });
    page = await app.firstWindow();
    await openProjectCanvas(page, app);
    await expect(page.locator('.react-flow__node-audio audio')).toBeVisible();
    await expect
      .poll(() =>
        page
          .locator('.react-flow__node-audio audio')
          .evaluate((element: HTMLAudioElement) => element.duration),
      )
      .toBeGreaterThan(0);
    expect(requests.filter((item) => item.path.includes('generateContent'))).toHaveLength(1);
    expect(tts.kind).toBe('tts');
  } finally {
    await disposeTestApp(app);
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
    await rm(userData, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
});
