import { expect, test, _electron, type ElectronApplication } from '@playwright/test';
import { GenerationJob } from '@frame-loom/contracts';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { addMediaChannel, addMediaModel, disposeTestApp, engineApi } from './model-service.fixture';
import { openProjectCanvas } from './project-canvas.fixture';

test('视频生成后编辑及续写，经待编辑视频槽位提交并写回', async () => {
  test.setTimeout(150_000);
  const bytes = await readFile(
    new URL(
      '../../engine/src/modules/generation/protocols/fixtures/reference.mp4',
      import.meta.url,
    ),
  );
  // 本地 2 秒夹具放慢三倍为 6 秒，满足编辑的 4 秒下限；无需新增二进制或编解码依赖。
  for (const atom of ['mvhd', 'mdhd']) {
    const index = bytes.indexOf(atom);
    expect(index).toBeGreaterThan(0);
    expect(bytes[index + 4]).toBe(0);
    bytes.writeUInt32BE(Math.round(bytes.readUInt32BE(index + 16) / 3), index + 16);
  }
  const submissions: Record<string, unknown>[] = [];
  let uploads = 0;
  let invalid = 0;
  const server = createServer((request, response) => {
    const path = request.url ?? '';
    if (request.method === 'PUT' && /^\/bucket\/audio\/[a-f0-9]{64}\.mp4$/.test(path)) {
      if (
        !request.headers.authorization?.startsWith('AWS4-HMAC-SHA256 Credential=local-storage/')
      ) {
        invalid++;
        response.writeHead(401).end();
        return;
      }
      request.resume();
      request.on('end', () => {
        uploads++;
        response.writeHead(200).end();
      });
      return;
    }
    if (request.method === 'GET' && path === '/result.mp4') {
      expect(request.headers.authorization).toBeUndefined();
      response.writeHead(200, { 'Content-Type': 'video/mp4' }).end(bytes);
      return;
    }
    const submit = request.method === 'POST' && path === '/api/v3/contents/generations/tasks';
    const query =
      request.method === 'GET' &&
      /^\/api\/v3\/contents\/generations\/tasks\/task-[1-3]$/.test(path);
    if (!submit && !query) {
      invalid++;
      response.writeHead(404).end();
      return;
    }
    if (request.headers.authorization !== 'Bearer fixture-local') {
      invalid++;
      response.writeHead(401).end();
      return;
    }
    response.setHeader('Content-Type', 'application/json');
    if (query) {
      response.end(
        JSON.stringify({
          id: path.split('/').at(-1),
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
      submissions.push(JSON.parse(body) as Record<string, unknown>);
      response.end(JSON.stringify({ id: `task-${submissions.length}` }));
    });
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const remote = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const desktop = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const userData = await mkdtemp(join(tmpdir(), 'loom-video-edit-'));
  let app: ElectronApplication | undefined;
  try {
    app = await _electron.launch({
      args: [
        resolve(desktop, 'e2e/fixtures/local-storage-main.cjs'),
        `--user-data-dir=${userData}`,
      ],
      env: { ...process.env, FRAME_LOOM_MOCK_STORAGE: remote },
    });
    const page = await app.firstWindow();
    await expect(page.getByRole('heading', { name: '帧织' })).toBeVisible();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1500, 960));
    const channel = await addMediaChannel(page, remote, 'fixture-local');
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
    const add = async (x: number) => {
      await editor.focus();
      await page.keyboard.press('Escape');
      const box = (await editor.boundingBox())!;
      await page.mouse.dblclick(box.x + x, box.y + 180);
      await page.getByRole('menuitem', { name: '视频', exact: true }).click();
    };
    await add(300);
    await page.getByLabel('生成提示词').fill('先生成原始片段');
    await page.getByRole('button', { name: '生成视频', exact: true }).click();
    await expect(page.locator('.react-flow__node-video video')).toBeVisible();
    await expect
      .poll(
        async () =>
          GenerationJob.array().parse(await engineApi(page, '/generation-jobs'))[0].outputs[0]
            .durationMs,
      )
      .toBeGreaterThanOrEqual(5900);
    await add(800);
    await page.getByRole('radio', { name: '视频编辑', exact: true }).click();
    await page.getByRole('button', { name: '添加待编辑视频', exact: true }).click();
    await page.getByRole('button', { name: '选择 视频', exact: true }).click();
    await expect(page.locator('.react-flow__edge')).toHaveCount(1);
    await page.getByLabel('生成提示词').fill('将原片段改成暖色');
    await page.getByRole('button', { name: '生成参数', exact: true }).click();
    await page.getByRole('radio', { name: '比例 adaptive', exact: true }).click();
    await page.getByRole('radio', { name: '自动时长 -1', exact: true }).click();
    await expect(page.getByRole('slider', { name: '时长', exact: true })).toBeDisabled();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: '生成视频', exact: true }).click();
    await expect
      .poll(
        async () =>
          GenerationJob.array()
            .parse(await engineApi(page, '/generation-jobs'))
            .filter((job) => job.status === 'succeeded').length,
      )
      .toBe(2);
    expect(submissions[1]).toMatchObject({
      omni_reference_task_type: 'edit',
      ratio: 'adaptive',
      duration: -1,
      content: [{ type: 'text' }, { type: 'video_url', role: 'reference_video' }],
    });
    await page.getByRole('radio', { name: '视频续写', exact: true }).click();
    await page.getByLabel('生成提示词').fill('向后延长原片段');
    await page.getByRole('button', { name: '生成视频', exact: true }).click();
    await expect
      .poll(
        async () =>
          GenerationJob.array()
            .parse(await engineApi(page, '/generation-jobs'))
            .filter((job) => job.status === 'succeeded').length,
      )
      .toBe(3);
    expect(submissions[2]).toMatchObject({
      omni_reference_task_type: 'extend',
      ratio: 'adaptive',
      content: [{ type: 'text' }, { role: 'reference_video' }],
    });
    await expect(page.locator('.react-flow__node-video').last().getByLabel('当前版本')).toHaveText(
      '2/2',
    );
    expect(submissions).toHaveLength(3);
    expect(uploads).toBe(1);
    expect(invalid).toBe(0);
    await expect(page.getByRole('status', { name: '画布保存状态' })).toHaveText('已保存');
  } finally {
    await disposeTestApp(app);
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
    await rm(userData, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
});
