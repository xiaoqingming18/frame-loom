import { expect, test, _electron, type ElectronApplication } from '@playwright/test';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const png =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aV1cAAAAASUVORK5CYII=';

test('界面添加图片渠道并测试，生成、内联参考图、明暗预览和重启保留', async ({}, info) => {
  const requests: string[] = [];
  const upstream = createServer((request, response) => {
    response.setHeader('Content-Type', 'application/json');
    if (request.method === 'GET') {
      response.end(JSON.stringify({ data: [{ id: 'gpt-image-1' }] }));
      return;
    }
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk: string) => {
      body += chunk;
    });
    request.on('end', () => {
      requests.push(body);
      response.end(JSON.stringify({ data: [{ b64_json: png }] }));
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
    await page.getByRole('button', { name: '添加所选（1）' }).click();
    const card = page.getByRole('group', { name: 'gpt-image-1' });
    await card.getByLabel('模型类别').selectOption('image');
    await card.getByLabel('调用协议').selectOption('openai-images');
    await expect(card.getByLabel('启用模型')).toBeChecked();
    await card.getByLabel('显示名称').fill('本地图片模型');
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await page.getByRole('button', { name: '编辑 图片模拟渠道' }).click();
    await page.getByRole('button', { name: '测试渠道' }).click();
    await expect(page.getByText(/地址与鉴权通过/)).toBeVisible();
    await page.getByRole('button', { name: '返回渠道列表' }).click();
    await page.getByRole('tab', { name: '默认模型' }).click();
    await page
      .getByRole('combobox', { name: '图片', exact: true })
      .selectOption({ label: '图片模拟渠道 / 本地图片模型' });
    await page.getByRole('button', { name: '关闭', exact: true }).click();
    await page.getByRole('link', { name: '模型测试' }).click();
    await page.getByRole('tab', { name: '图片', exact: true }).click();
    await page.getByLabel('图片提示词').fill('一束暖光落在旧电影胶片上');
    await page.getByRole('button', { name: '生成图片', exact: true }).click();
    const preview = page.getByRole('img', { name: '生成图片 1' });
    await expect(preview).toBeVisible();
    await expect
      .poll(() =>
        preview
          .first()
          .evaluate(
            (img: { complete: boolean; naturalWidth: number }) => img.complete && img.naturalWidth,
          ),
      )
      .toBe(1);
    expect(requests).toHaveLength(1);
    expect(JSON.parse(requests[0])).toMatchObject({
      model: 'gpt-image-1',
      prompt: '一束暖光落在旧电影胶片上',
      n: 1,
    });
    for (const theme of ['light', 'dark']) {
      await page.evaluate(`window.frameLoom.theme.set('${theme}')`);
      await expect(page.locator('body')).toHaveCSS(
        'background-color',
        theme === 'dark' ? 'rgb(13, 13, 15)' : 'rgb(246, 247, 249)',
      );
      await page.screenshot({ path: info.outputPath(`image-lab-${theme}.png`) });
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
    await page.screenshot({ path: info.outputPath('image-lab-small.png') });
    await page.getByLabel('生成模式').selectOption('reference');
    await expect(page.getByLabel('生成模式')).toHaveValue('reference');
    await page.locator('input[type="file"]').setInputFiles({
      name: 'reference.png',
      mimeType: 'image/png',
      buffer: Buffer.from(png, 'base64'),
    });
    await page.getByRole('button', { name: '生成图片', exact: true }).click();
    await expect(preview).toHaveCount(2);
    expect(requests).toHaveLength(2);
    expect(requests[1]).toContain('name="image[]"');
    expect(await readdir(join(userData, 'media'))).toEqual([
      expect.stringMatching(/^[a-f0-9]{64}\.png$/),
    ]);
    expect(errors).toEqual([]);
    await app.close();
    app = undefined;
    app = await _electron.launch({ args: [desktop, `--user-data-dir=${userData}`] });
    page = await app.firstWindow();
    await page.getByRole('link', { name: '模型测试' }).click();
    await page.getByRole('tab', { name: '图片', exact: true }).click();
    await expect(page.getByRole('img', { name: '生成图片 1' })).toHaveCount(2);
    await expect
      .poll(() =>
        page
          .getByRole('img', { name: '生成图片 1' })
          .first()
          .evaluate(
            (img: { complete: boolean; naturalWidth: number }) => img.complete && img.naturalWidth,
          ),
      )
      .toBe(1);
    expect(requests).toHaveLength(2);
  } finally {
    await app?.close();
    upstream.closeAllConnections();
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
    await rm(userData, { recursive: true, force: true });
  }
});
