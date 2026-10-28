import { openProjectCanvas, canvasFixture } from './project-canvas.fixture';
import { addMediaChannel, addMediaModel, disposeTestApp, engineApi } from './model-service.fixture';
import type { GenerationJob } from '@frame-loom/contracts';
import { expect, test, _electron, type ElectronApplication } from '@playwright/test';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

test('能力卡驱动图片与首尾帧视频生成、引用与版本重启保留', async ({}, info) => {
  test.setTimeout(150_000);
  const imageRequests: string[] = [];
  const videoRequests: Record<string, unknown>[] = [];
  const png = (await readFile(new URL('./fixtures/reference-256.png', import.meta.url))).toString(
    'base64',
  );
  const video = await readFile(
    new URL(
      '../../engine/src/modules/generation/protocols/fixtures/reference.mp4',
      import.meta.url,
    ),
  );
  const upstream = createServer((request, response) => {
    const path = request.url;
    if (request.method === 'GET' && path === '/result.mp4') {
      expect(request.headers.authorization).toBeUndefined();
      response.writeHead(200, { 'Content-Type': 'video/mp4' }).end(video);
      return;
    }
    const allowed =
      (request.method === 'POST' &&
        [
          '/v1/images/generations',
          '/v1/images/edits',
          '/api/v3/contents/generations/tasks',
        ].includes(path ?? '')) ||
      (request.method === 'GET' && path === '/api/v3/contents/generations/tasks/video-task');
    if (!allowed) {
      response.writeHead(404).end();
      return;
    }
    if (request.headers.authorization !== 'Bearer fixture-local') {
      response.writeHead(401).end();
      return;
    }
    response.setHeader('Content-Type', 'application/json');
    if (request.method === 'GET') {
      response.end(
        JSON.stringify({
          id: 'video-task',
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
      if (path?.includes('/images/')) {
        imageRequests.push(body);
        response.end(JSON.stringify({ data: [{ b64_json: png }] }));
      } else {
        videoRequests.push(JSON.parse(body) as Record<string, unknown>);
        response.end(JSON.stringify({ id: 'video-task' }));
      }
    });
  });
  await new Promise<void>((done) => upstream.listen(0, '127.0.0.1', done));
  const remote = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
  const userData = await mkdtemp(join(tmpdir(), 'frame-loom-generation-'));
  const desktop = resolve(fileURLToPath(new URL('..', import.meta.url)));
  let app: ElectronApplication | undefined;
  try {
    app = await _electron.launch({ args: [desktop, `--user-data-dir=${userData}`] });
    let page = await app.firstWindow();
    await expect(page.getByRole('heading', { name: '帧织' })).toBeVisible();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1500, 960));
    const channel = await addMediaChannel(page, remote, 'fixture-local');
    await addMediaModel(page, channel.id, 'openai-images', '本地图片模型');
    await addMediaModel(page, channel.id, 'ark-seedance', '本地视频模型');
    await openProjectCanvas(page, app);
    const add = async (label: string, x: number) => {
      const editor = page.getByRole('region', { name: '画布编辑区' });
      await editor.focus();
      await page.keyboard.press('Escape');
      const box = (await editor.boundingBox())!;
      await page.mouse.dblclick(box.x + x, box.y + 180);
      await page.getByRole('menuitem', { name: label, exact: true }).click();
    };
    await add('图片', 300);
    await page.getByLabel('生成提示词').fill('胶片与暖光');
    await page.getByRole('button', { name: '生成参数', exact: true }).click();
    await page.getByRole('radio', { name: '档位 1K', exact: true }).click();
    await page.getByRole('radio', { name: '比例 1:1', exact: true }).click();
    await expect(page.getByLabel('预计像素')).toHaveText('1024×1024');
    for (const theme of ['light', 'dark'] as const) {
      await page.evaluate(`window.frameLoom.theme.set('${theme}')`);
      await page.emulateMedia({ colorScheme: theme });
      await expect(page.locator('body')).toHaveCSS(
        'background-color',
        theme === 'dark' ? 'rgb(13, 13, 15)' : 'rgb(246, 247, 249)',
      );
      await page.keyboard.press('Tab');
      await page.screenshot({
        path: info.outputPath(`image-params-${theme}.png`),
        animations: 'disabled',
      });
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: '折叠侧栏', exact: true }).click();
      await page.setViewportSize({ width: 800, height: 800 });
      await page.getByRole('button', { name: '生成参数', exact: true }).click();
      const bounds = (await page.getByLabel('生成参数', { exact: true }).last().boundingBox())!;
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(800);
      await page.keyboard.press('Tab');
      await page.screenshot({
        path: info.outputPath(`image-params-${theme}-800.png`),
        animations: 'disabled',
      });
      await page.keyboard.press('Escape');
      await page.setViewportSize({ width: 1500, height: 960 });
      await page.getByRole('button', { name: '展开侧栏', exact: true }).click();
      await page.getByRole('button', { name: '生成参数', exact: true }).click();
    }
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: '生成图片', exact: true }).click();
    await expect(page.locator('.react-flow__node-image img')).toBeVisible();
    expect(imageRequests).toHaveLength(1);
    expect(JSON.parse(imageRequests[0])).toMatchObject({ prompt: '胶片与暖光', size: '1024x1024' });

    await add('图片', 700);
    const prompt = page.getByRole('textbox', { name: '生成提示词' });
    await prompt.fill('参考 @');
    await expect(page.getByRole('listbox', { name: '引用参考' })).toBeVisible();
    await prompt.press('Enter');
    await expect(prompt.locator('[data-reference]')).toHaveText('图1');
    await page.getByRole('button', { name: '生成图片', exact: true }).click();
    await expect
      .poll(async () => {
        const jobs = (await engineApi(page, '/generation-jobs')) as GenerationJob[];
        return jobs.map((job) =>
          job.status === 'succeeded' ? 'succeeded' : `${job.status}: ${job.errorMessage}`,
        );
      })
      .toEqual(['succeeded', 'succeeded']);
    await expect(page.locator('.react-flow__node-image img')).toHaveCount(2);
    expect(imageRequests).toHaveLength(2);
    expect(imageRequests[1]).toContain('参考 图1');

    await add('视频', 950);
    const videoNode = page.locator('.react-flow__node-video');
    await expect(page.getByRole('radio', { name: '文生视频', exact: true })).toBeChecked();
    await page.getByRole('radio', { name: '首尾帧', exact: true }).click();
    for (const role of ['首帧', '尾帧']) {
      await page.getByRole('button', { name: `添加${role}`, exact: true }).click();
      await page
        .getByRole('dialog', { name: `选择${role}`, exact: true })
        .getByRole('button', { name: /^选择 / })
        .first()
        .click();
    }
    await page.getByLabel('生成提示词').fill('让暖光缓慢移动');
    await page.getByRole('button', { name: '生成参数', exact: true }).click();
    await expect(
      page
        .getByRole('region', { name: '比例', exact: true })
        .getByText('Seedance 首帧与首尾帧方式由输入图决定比例，只能选择自适应', { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('radio', { name: '比例 16:9', exact: true })).toBeDisabled();
    await page.getByRole('radio', { name: '比例 adaptive', exact: true }).click();
    for (const theme of ['light', 'dark'] as const) {
      await page.evaluate(`window.frameLoom.theme.set('${theme}')`);
      await page.emulateMedia({ colorScheme: theme });
      await expect(page.locator('body')).toHaveCSS(
        'background-color',
        theme === 'dark' ? 'rgb(13, 13, 15)' : 'rgb(246, 247, 249)',
      );
      await page.screenshot({
        path: info.outputPath(`video-params-${theme}.png`),
        animations: 'disabled',
      });
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: '折叠侧栏', exact: true }).click();
      await page.setViewportSize({ width: 800, height: 800 });
      await page.getByRole('button', { name: '生成参数', exact: true }).click();
      const bounds = (await page.getByLabel('生成参数', { exact: true }).last().boundingBox())!;
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(800);
      await page.keyboard.press('Tab');
      await page.screenshot({
        path: info.outputPath(`video-params-${theme}-800.png`),
        animations: 'disabled',
      });
      await page.keyboard.press('Escape');
      await page.setViewportSize({ width: 1500, height: 960 });
      await page.getByRole('button', { name: '展开侧栏', exact: true }).click();
      await page.getByRole('button', { name: '生成参数', exact: true }).click();
    }
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: '生成视频', exact: true }).click();
    await expect(videoNode.locator('video')).toBeVisible();
    expect(videoRequests).toHaveLength(1);
    expect(videoRequests[0]).toMatchObject({
      model: '本地视频模型',
      ratio: 'adaptive',
      content: [
        { type: 'text', text: '让暖光缓慢移动' },
        { type: 'image_url', role: 'first_frame' },
        { type: 'image_url', role: 'last_frame' },
      ],
    });
    await expect(page.getByRole('status', { name: '画布保存状态' })).toHaveText('已保存');
    expect((await canvasFixture(page)).rootPath).toContain('验收项目');
    await app.close();
    app = await _electron.launch({ args: [desktop, `--user-data-dir=${userData}`] });
    page = await app.firstWindow();
    await openProjectCanvas(page, app);
    await expect(page.locator('.react-flow__node-image img')).toHaveCount(2);
    await page.locator('.react-flow__node-video').hover();
    await expect(page.locator('.react-flow__node-video video')).toBeVisible();
    expect(imageRequests).toHaveLength(2);
    expect(videoRequests).toHaveLength(1);
  } finally {
    await disposeTestApp(app);
    upstream.closeAllConnections();
    await new Promise<void>((done) => upstream.close(() => done()));
    await rm(userData, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
});
