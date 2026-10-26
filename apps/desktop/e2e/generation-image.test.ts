import { expect, test, _electron, type ElectronApplication } from '@playwright/test';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Locator, Page } from '@playwright/test';

async function drag(page: Page, source: Locator, target: Locator) {
  const from = (await source.boundingBox())!;
  const to = (await target.boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
  await page.mouse.up();
}

test('画布三张图片生成、失败单张重试、首帧视频生成与版本重启保留', async ({}, info) => {
  const imageRequests: string[] = [];
  const videoRequests: string[] = [];
  const png = (await readFile(new URL('./fixtures/reference-256.png', import.meta.url))).toString(
    'base64',
  );
  const video = await readFile(
    new URL('../../engine/src/modules/generation/adapters/fixtures/reference.mp4', import.meta.url),
  );
  const upstream = createServer((request, response) => {
    response.setHeader('Content-Type', 'application/json');
    if (request.method === 'GET') {
      const path = new URL(request.url!, 'http://localhost').pathname;
      if (path.endsWith('/models')) {
        response.end(
          JSON.stringify({ data: [{ id: 'gpt-image-1' }, { id: 'doubao-seedance-2-0' }] }),
        );
      } else if (path.includes('/contents/generations/tasks/')) {
        response.end(
          JSON.stringify({
            id: 'video-task',
            status: 'succeeded',
            content: { video_url: `${remote}/result.mp4` },
          }),
        );
      } else if (path === '/v1/result.mp4') {
        response.writeHead(200, { 'Content-Type': 'video/mp4' }).end(video);
      } else {
        response.writeHead(404).end();
      }
      return;
    }
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk: string) => {
      body += chunk;
    });
    request.on('end', () => {
      const path = new URL(request.url!, 'http://localhost').pathname;
      if (path.endsWith('/images/generations')) {
        imageRequests.push(body);
        if (imageRequests.length === 2) {
          response
            .writeHead(400)
            .end(JSON.stringify({ error: { message: '第二张模拟失败', code: 'invalid_params' } }));
          return;
        }
        response.end(JSON.stringify({ data: [{ b64_json: png }] }));
      } else if (path.endsWith('/contents/generations/tasks')) {
        videoRequests.push(body);
        response.end(JSON.stringify({ id: 'video-task' }));
      } else {
        response.writeHead(404).end();
      }
    });
  });
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  const remote = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}/v1`;
  const userData = await mkdtemp(join(tmpdir(), 'frame-loom-image-ui-'));
  const desktop = resolve(fileURLToPath(new URL('..', import.meta.url)));
  let app: ElectronApplication | undefined;
  try {
    app = await _electron.launch({ args: [desktop, `--user-data-dir=${userData}`] });
    let page = await app.firstWindow();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1500, 960));
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (/Content Security Policy|Refused to/.test(message.text())) errors.push(message.text());
    });
    await page.emulateMedia({ colorScheme: null });
    await page.getByRole('button', { name: '设置中心' }).click();
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await page.getByRole('tab', { name: '模型服务' }).click();
    await page.getByRole('button', { name: '添加渠道' }).click();
    await page.getByLabel('渠道名称').fill('图片模拟渠道');
    await page.getByLabel('API 格式').selectOption('openai-completions');
    await page.getByLabel('接口地址').fill(remote);
    await page.getByLabel('API 密钥').fill('sk-image-e2e-private');
    await page.getByRole('button', { name: '拉取模型' }).click();
    await page.getByLabel(/gpt-image-1/).check();
    await page.getByLabel(/doubao-seedance-2-0/).check();
    await page.getByRole('button', { name: '添加所选（2）' }).click();
    const card = page.getByRole('group', { name: 'gpt-image-1' });
    await card.getByLabel('模型类别').selectOption('image');
    await card.getByLabel('调用协议').selectOption('openai-images');
    await expect(card.getByLabel('启用模型')).toBeChecked();
    await card.getByLabel('显示名称').fill('本地图片模型');
    const videoCard = page.getByRole('group', { name: 'doubao-seedance-2-0' });
    await videoCard.getByLabel('模型类别').selectOption('video');
    await videoCard.getByLabel('调用协议').selectOption('ark-video-tasks');
    await videoCard.getByLabel('显示名称').fill('本地视频模型');
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await page.getByRole('button', { name: '编辑 图片模拟渠道' }).click();
    await page.getByRole('button', { name: '测试渠道' }).click();
    await expect(page.getByText(/地址与鉴权通过/)).toBeVisible();
    await page.getByRole('button', { name: '返回渠道列表' }).click();
    await page.getByRole('tab', { name: '默认模型' }).click();
    await page
      .getByRole('combobox', { name: '图片', exact: true })
      .selectOption({ label: '图片模拟渠道 / 本地图片模型' });
    await page
      .getByRole('combobox', { name: '视频', exact: true })
      .selectOption({ label: '图片模拟渠道 / 本地视频模型' });
    await page.getByRole('button', { name: '关闭', exact: true }).click();
    await page.getByRole('link', { name: '画布测试' }).click();
    const editor = page.getByRole('region', { name: '画布编辑区' });
    await page.mouse.dblclick(
      (await editor.boundingBox())!.x + 300,
      (await editor.boundingBox())!.y + 260,
    );
    await page.getByRole('menuitem', { name: '图片', exact: true }).click();
    await page.getByLabel('生成提示词').fill('一束暖光落在旧电影胶片上');
    const composer = page.locator('.react-flow__node-toolbar > div');
    const screenshots = resolve(desktop, '../../.cache/canvas-image-node');
    await mkdir(screenshots, { recursive: true });
    await page.getByRole('button', { name: '生成参数' }).click();
    const parameters = page.getByRole('dialog', { name: '生成参数' });
    const viewport = await page.locator('.react-flow__viewport').getAttribute('style');
    await parameters.hover();
    await page.mouse.wheel(0, 300);
    expect(await page.locator('.react-flow__viewport').getAttribute('style')).toBe(viewport);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: '生成数量' }).click();
    await page.getByRole('button', { name: '×3', exact: true }).click();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(720, 560));
    for (const theme of ['light', 'dark']) {
      await page.evaluate(`window.frameLoom.theme.set('${theme}')`);
      await expect(page.locator('body')).toHaveCSS(
        'background-color',
        theme === 'dark' ? 'rgb(13, 13, 15)' : 'rgb(246, 247, 249)',
      );
      await expect
        .poll(async () => {
          const box = await composer.boundingBox();
          const viewport =
            page.viewportSize() ??
            (await page.evaluate(() => ({ width: innerWidth, height: innerHeight })));
          const canvasBounds = (await editor.boundingBox())!;
          return (
            !!box &&
            box.x >= canvasBounds.x &&
            box.y >= canvasBounds.y &&
            box.x + box.width <= viewport.width &&
            box.y + box.height <= viewport.height
          );
        })
        .toBe(true);
      await page.screenshot({
        path: join(screenshots, `composer-small-${theme}.png`),
        animations: 'disabled',
      });
      await page.getByRole('button', { name: '生成参数' }).click();
      await expect(parameters).toBeVisible();
      const bounds = (await parameters.boundingBox())!;
      const windowSize = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.y).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(windowSize.width);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(windowSize.height);
      await page.screenshot({
        path: join(screenshots, `params-small-${theme}.png`),
        animations: 'disabled',
      });
      await page.keyboard.press('Escape');
      await expect(page.getByRole('button', { name: '生成参数' })).toBeFocused();
    }
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1500, 960));
    await page.getByRole('button', { name: '生成图片', exact: true }).click();
    const preview = page.locator('.react-flow__node-image img');
    await expect(preview).toBeVisible();
    await expect
      .poll(() =>
        preview
          .first()
          .evaluate((img) => img instanceof HTMLImageElement && img.complete && img.naturalWidth),
      )
      .toBe(256);
    await expect(page.getByLabel('当前版本')).toContainText('/2');
    await page.getByRole('button', { name: /重试任务/ }).click();
    await expect(page.getByLabel('当前版本')).toContainText('/3');
    expect(imageRequests).toHaveLength(4);
    expect(JSON.parse(imageRequests[0])).toMatchObject({
      model: 'gpt-image-1',
      prompt: '一束暖光落在旧电影胶片上',
      size: '1024x1024',
    });

    const box = (await editor.boundingBox())!;
    await page.mouse.dblclick(box.x + 760, box.y + 260);
    await page.getByRole('menuitem', { name: '视频', exact: true }).click();
    const videoNode = page.locator('.react-flow__node-video');
    await page.getByRole('radio', { name: '首尾帧', exact: true }).click();
    await drag(
      page,
      page.locator('.react-flow__node-image [data-handleid="out"]'),
      videoNode.locator('[data-handleid="first_frame"]'),
    );
    await videoNode.click();
    await page.getByLabel('生成提示词').fill('让这束暖光缓慢掠过胶片');
    await page.getByRole('button', { name: '生成视频', exact: true }).click();
    const previewVideo = videoNode.locator('video');
    await expect(previewVideo).toBeVisible();
    await expect
      .poll(() =>
        previewVideo.evaluate(
          (element) => element instanceof HTMLVideoElement && element.readyState,
        ),
      )
      .toBeGreaterThan(0);
    expect(videoRequests).toHaveLength(1);
    expect(JSON.parse(videoRequests[0])).toMatchObject({
      model: 'doubao-seedance-2-0',
      content: [
        { type: 'text', text: '让这束暖光缓慢掠过胶片' },
        { type: 'image_url', role: 'first_frame' },
      ],
    });
    for (const theme of ['light', 'dark']) {
      await page.evaluate(`window.frameLoom.theme.set('${theme}')`);
      await expect(page.locator('body')).toHaveCSS(
        'background-color',
        theme === 'dark' ? 'rgb(13, 13, 15)' : 'rgb(246, 247, 249)',
      );
      await page.screenshot({ path: info.outputPath(`canvas-generation-${theme}.png`) });
    }
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(720, 560));
    expect(
      await page
        .locator('main')
        .evaluate(
          (element: { scrollWidth: number; clientWidth: number }) =>
            element.scrollWidth <= element.clientWidth,
        ),
    ).toBe(true);
    await page.screenshot({ path: info.outputPath('canvas-generation-small.png') });
    expect(await readdir(join(userData, 'media'))).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^[a-f0-9]{64}\.png$/),
        expect.stringMatching(/^[a-f0-9]{64}\.mp4$/),
      ]),
    );
    expect(errors).toEqual([]);
    await app.close();
    app = undefined;
    app = await _electron.launch({ args: [desktop, `--user-data-dir=${userData}`] });
    page = await app.firstWindow();
    await page.getByRole('link', { name: '画布测试' }).click();
    await expect(page.locator('.react-flow__node-image img')).toHaveCount(1);
    await expect
      .poll(() =>
        page
          .locator('.react-flow__node-image img')
          .first()
          .evaluate((img) => img instanceof HTMLImageElement && img.complete && img.naturalWidth),
      )
      .toBe(256);
    expect(imageRequests).toHaveLength(4);
    expect(videoRequests).toHaveLength(1);
  } finally {
    await app?.close();
    upstream.closeAllConnections();
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
    await rm(userData, { recursive: true, force: true });
  }
});
