import { expect, test, _electron, type ElectronApplication } from '@playwright/test';
import { Model, getProtocol } from '@frame-loom/contracts';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { addMediaChannel, addMediaModel, disposeTestApp, engineApi } from './model-service.fixture';
import { openProjectCanvas } from './project-canvas.fixture';

test('生成卡片：三类动效、明暗切换与取消', async ({}, info) => {
  test.setTimeout(150_000);
  // 模拟供应商保持请求未完成，验收真实任务运行时的生成状态。
  const server = createServer((request) => request.resume());
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const remote = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const userData = await mkdtemp(join(tmpdir(), 'loom-generation-loading-'));
  const desktop = resolve(fileURLToPath(new URL('..', import.meta.url)));
  let app: ElectronApplication | undefined;
  try {
    app = await _electron.launch({ args: [desktop, `--user-data-dir=${userData}`] });
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (/Content Security Policy|Refused to/.test(message.text())) errors.push(message.text());
    });
    await expect(page.getByRole('heading', { name: '帧织' })).toBeVisible();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1800, 960));
    const channel = await addMediaChannel(page, remote, 'fixture-local');
    await addMediaModel(page, channel.id, 'openai-images', '本地图片');
    await addMediaModel(page, channel.id, 'ark-seedance', '本地视频');
    const protocol = getProtocol('gemini-generate')!;
    Model.array().parse(
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
    );
    await openProjectCanvas(page, app);
    const editor = page.getByRole('region', { name: '画布编辑区' });
    for (const [kind, label, x] of [
      ['image', '图片', 220],
      ['video', '视频', 620],
      ['audio', '音频', 1000],
    ] as const) {
      await editor.focus();
      await page.keyboard.press('Escape');
      const box = (await editor.boundingBox())!;
      await page.mouse.dblclick(box.x + x, box.y + 320);
      await page.getByRole('menuitem', { name: label, exact: true }).click();
      await page.getByLabel('生成提示词').fill('生成动效验收');
      if (kind === 'audio') {
        await page.getByRole('button', { name: '生成参数', exact: true }).click();
        await page.getByRole('combobox', { name: '音色', exact: true }).selectOption('Kore');
        await page.keyboard.press('Escape');
      }
      await page.getByRole('button', { name: `生成${label}`, exact: true }).click();
      const node = page.locator(`.react-flow__node-${kind}`);
      const loading = node.locator('.canvas-generation-active');
      await expect(loading.getByRole('status')).toHaveText('生成中');
      const cancel = loading.getByRole('button', { name: '放弃任务', exact: true });
      await expect(cancel).toHaveText('取消');
      await expect(cancel).toBeEnabled();
      if (kind === 'image')
        await expect(loading.locator('.canvas-generation-rain i')).toHaveCount(15);
      if (kind === 'video')
        await expect(loading.locator('.canvas-generation-streak')).toHaveCount(72);
      if (kind === 'audio') {
        await expect
          .poll(() =>
            loading.locator('canvas').evaluate((canvas: HTMLCanvasElement) => {
              const pixels = canvas
                .getContext('2d')!
                .getImageData(0, 0, canvas.width, canvas.height).data;
              let top = canvas.height;
              let bottom = 0;
              for (let index = 3; index < pixels.length; index += 4) {
                if (pixels[index] === 0) continue;
                const y = Math.floor(index / 4 / canvas.width);
                top = Math.min(top, y);
                bottom = Math.max(bottom, y);
              }
              return bottom - top > canvas.height * 0.2;
            }),
          )
          .toBe(true);
      }
      for (const theme of ['light', 'dark'] as const) {
        await page.evaluate(`window.frameLoom.theme.set('${theme}')`);
        await page.emulateMedia({ colorScheme: theme });
        await expect(loading.locator('.canvas-generation-animation')).toHaveCSS(
          'background-color',
          theme === 'dark' ? 'rgb(22, 22, 27)' : 'rgb(255, 255, 255)',
        );
        await expect(loading.locator('.canvas-generation-tag')).toHaveCSS('top', '16px');
        await expect(loading.locator('.canvas-generation-tag')).toHaveCSS('left', '16px');
        await expect(loading.locator('.canvas-generation-tag')).toHaveCSS('font-size', '10px');
        await page.mouse.move(0, 0);
        await expect(loading.locator('.canvas-generation-details')).toHaveCSS('opacity', '0');
        await node.screenshot({ path: info.outputPath(`loading-${kind}-${theme}.png`) });
      }
      await cancel.focus();
      await expect(loading.locator('.canvas-generation-details')).toHaveCSS('opacity', '1');
      await page.keyboard.press('Enter');
      await expect(loading).toHaveCount(0);
    }
    await expect(page.locator('.canvas-generation-animation')).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    await disposeTestApp(app);
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
    await rm(userData, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
});
