import { expect, test, _electron, type Locator, type Page } from '@playwright/test';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const desktop = resolve(fileURLToPath(new URL('..', import.meta.url)));
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aV1cAAAAASUVORK5CYII=',
  'base64',
);

async function drag(page: Page, source: Locator, target: Locator) {
  const a = (await source.boundingBox())!;
  const b = (await target.boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 });
  await page.mouse.up();
}

test('节点连线：类型、重复、环、端口限额、方式切换一步撤销与剪贴板', async ({}, info) => {
  const userData = await mkdtemp(join(tmpdir(), 'frame-loom-canvas-nodes-'));
  const app = await _electron.launch({ args: [desktop, `--user-data-dir=${userData}`] });
  try {
    const page = await app.firstWindow();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1500, 960));
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (/Content Security Policy|Refused to|\[React Flow\]/.test(message.text()))
        errors.push(message.text());
    });
    await page.getByRole('link', { name: '画布测试' }).click();
    const editor = page.getByRole('region', { name: '画布编辑区' });
    const box = (await editor.boundingBox())!;
    const add = async (x: number, y: number, label: string) => {
      await page.mouse.dblclick(box.x + x, box.y + y);
      await page.getByRole('menuitem', { name: label, exact: true }).click();
      await expect(page.locator('.react-flow__node'), errors.join('\n')).not.toHaveCount(0);
    };
    await add(200, 280, '图片');
    await add(200, 650, '图片');
    await add(740, 340, '视频');
    const images = page.locator('.react-flow__node-image');
    const video = page.locator('.react-flow__node-video');
    await expect(images).toHaveCount(2);
    await page.getByRole('radio', { name: '首尾帧', exact: true }).click();
    const out = (node: Locator) => node.locator('[data-handleid="out"]');
    const first = video.locator('[data-handleid="first_frame"]');
    await drag(page, out(images.nth(0)), first);
    await expect(page.locator('.react-flow__edge')).toHaveCount(1);
    await drag(page, out(images.nth(1)), first);
    await expect(page.getByRole('status')).toContainText('最多 1 条连线');
    await drag(page, out(video), images.nth(0).locator('[data-handleid="reference"]'));
    await expect(page.getByRole('status')).toContainText('不接受视频');
    await drag(page, out(images.nth(0)), first);
    await expect(page.getByRole('status')).toContainText('已经连接');
    await drag(page, out(images.nth(0)), images.nth(1).locator('[data-handleid="reference"]'));
    await expect(page.locator('.react-flow__edge')).toHaveCount(2);
    await drag(page, out(images.nth(1)), images.nth(0).locator('[data-handleid="reference"]'));
    await expect(page.getByRole('status')).toContainText('循环依赖');
    await page.getByRole('radio', { name: '文生视频', exact: true }).click();
    await expect(page.locator('.react-flow__edge')).toHaveCount(1);
    await expect(page.getByRole('status')).toContainText('断开 1 条');
    await page.getByRole('button', { name: '撤销', exact: true }).click();
    await expect(page.locator('.react-flow__edge')).toHaveCount(2);
    await expect(page.getByRole('radio', { name: '首尾帧', exact: true })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    // 拖到空白处只显示可接端口的类型，建节点和连线合并为一步撤销。
    const start = (await out(images.nth(0)).boundingBox())!;
    await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 1100, box.y + 650, { steps: 12 });
    await page.mouse.up();
    await expect(page.getByRole('menuitem', { name: '视频', exact: true })).toHaveCount(0);
    await page.getByRole('menuitem', { name: '图片', exact: true }).click();
    await expect(images).toHaveCount(3);
    await expect(page.locator('.react-flow__edge')).toHaveCount(3);
    await page.getByRole('button', { name: '撤销', exact: true }).click();
    await expect(images).toHaveCount(2);
    await expect(page.locator('.react-flow__edge')).toHaveCount(2);
    await editor.focus();
    await page.keyboard.press('Escape');
    await page.mouse.move(box.x + 1100, box.y + 650);
    for (const label of ['隐藏', '仅选中相关', '全部显示']) {
      await page.getByRole('button', { name: '连线显示', exact: true }).click();
      await page.getByRole('menuitemradio', { name: label, exact: true }).click();
      await expect(page.locator('.react-flow__edge')).toHaveCount(label === '全部显示' ? 2 : 0);
    }
    for (const theme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: theme });
      await page.screenshot({ path: info.outputPath(`canvas-nodes-${theme}.png`) });
    }
    await editor.focus();
    await page.keyboard.press('Control+a');
    // 使用浏览器剪贴板事件检查双格式传输，避免修改用户的系统剪贴板。
    const copied = await editor.evaluate((element) => {
      const clipboardData = new DataTransfer();
      element.dispatchEvent(
        new ClipboardEvent('copy', { clipboardData, bubbles: true, cancelable: true }),
      );
      return {
        custom: clipboardData.getData('application/x-frame-loom-canvas'),
        text: clipboardData.getData('text/plain'),
      };
    });
    expect(copied.custom).toBe(copied.text);
    expect(
      (JSON.parse(copied.text.split('frame-loom-canvas/v1:')[1]) as { edges: unknown[] }).edges,
    ).toHaveLength(2);
    await editor.evaluate((element, text) => {
      const clipboardData = new DataTransfer();
      clipboardData.setData('text/plain', text);
      element.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }),
      );
    }, copied.text);
    await expect(page.locator('.react-flow__node-image')).toHaveCount(4);
    await expect(page.locator('.react-flow__edge')).toHaveCount(4);
    await editor.focus();
    await page.keyboard.press('Control+z');
    await expect(images).toHaveCount(2);
    expect(errors).toEqual([]);
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
  }
});

test('媒体导入：上传、拖入、粘贴、视频封面和单播放器', async ({}, info) => {
  test.setTimeout(120_000);
  const userData = await mkdtemp(join(tmpdir(), 'frame-loom-canvas-media-'));
  const app = await _electron.launch({ args: [desktop, `--user-data-dir=${userData}`] });
  try {
    const page = await app.firstWindow();
    await page.getByRole('link', { name: '画布测试' }).click();
    const messages: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') messages.push(message.text());
    });
    page.on('pageerror', (error) => messages.push(error.message));
    const editor = page.getByRole('region', { name: '画布编辑区' });
    await page.getByRole('button', { name: '添加节点', exact: true }).click();
    await expect(page.getByRole('menuitem', { name: '上传图片或视频', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    const input = page.getByLabel('上传图片或视频', { exact: true });
    await input.setInputFiles({ name: '图片.png', mimeType: 'image/png', buffer: png });
    await expect(page.locator('.react-flow__node-image img')).toBeVisible();
    await expect(page.locator('.react-flow__node-upload')).toHaveCount(0);
    for (const event of ['drop', 'paste']) {
      await editor.evaluate(
        (element, { base64, event }) => {
          const data = new DataTransfer();
          data.items.add(
            new File(
              [Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))],
              `${event}.png`,
              { type: 'image/png' },
            ),
          );
          element.dispatchEvent(
            event === 'drop'
              ? new DragEvent('drop', {
                  dataTransfer: data,
                  bubbles: true,
                  cancelable: true,
                  clientX: 500,
                  clientY: 400,
                })
              : new ClipboardEvent('paste', {
                  clipboardData: data,
                  bubbles: true,
                  cancelable: true,
                }),
          );
        },
        { base64: png.toString('base64'), event },
      );
    }
    await expect(page.locator('.react-flow__node-image')).toHaveCount(3);
    const fixture = resolve(
      desktop,
      '../engine/src/modules/generation/adapters/fixtures/reference.mp4',
    );
    await input.setInputFiles(fixture);
    const video = page.locator('.react-flow__node-video');
    await expect(video).toHaveCount(1);
    await editor.focus();
    await page.keyboard.press('Escape');
    await page.mouse.move(250, 180);
    await info.attach('浏览器错误', { body: messages.join('\n'), contentType: 'text/plain' });
    await expect(video.locator('img'), messages.join('\n')).toBeVisible();
    await expect
      .poll(async () =>
        (await readdir(join(userData, 'media'))).some((file) => file.endsWith('.webp')),
      )
      .toBe(true);
    await editor.focus();
    await page.keyboard.press('Control+a');
    await page.keyboard.press('Control+d');
    await expect(page.locator('.react-flow__node-video')).toHaveCount(2);
    await expect(page.locator('.react-flow__node-video video')).toHaveCount(1);
    for (const theme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: theme });
      await page.screenshot({ path: info.outputPath(`canvas-media-${theme}.png`) });
    }
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
  }
});
