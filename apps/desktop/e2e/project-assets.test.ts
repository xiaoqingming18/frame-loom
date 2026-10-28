import { test, expect, _electron } from '@playwright/test';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openProjectCanvas } from './project-canvas.fixture';

test('项目资产：上传、目录、移动、搜索、预览、画布双向复制和回收站', async () => {
  test.setTimeout(120_000);
  const sandbox = await mkdtemp(join(tmpdir(), 'frame-assets-e2e-'));
  const desktop = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const screenshots = resolve(desktop, '../../.cache/project-library');
  await mkdir(screenshots, { recursive: true });
  const app = await _electron.launch({ args: [desktop, `--user-data-dir=${sandbox}`] });
  try {
    const page = await app.firstWindow();
    const target = await openProjectCanvas(page, app);
    await page
      .getByRole('navigation', { name: '画布面包屑' })
      .getByRole('link', { name: '验收项目', exact: true })
      .click();
    await page.getByRole('tab', { name: '项目资产', exact: true }).click();
    const imagePath = fileURLToPath(new URL('./fixtures/reference-256.png', import.meta.url));
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: '上传文件', exact: true }).click();
    await (await chooser).setFiles(imagePath);
    await expect(
      page.getByRole('button', { name: 'reference-256.png', exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('region', { name: '上传队列' }).getByText('已完成')).toBeVisible();
    await page.getByLabel('上传项目文件').setInputFiles(imagePath);
    await expect(
      page.getByRole('button', { name: 'reference-256 (2).png', exact: true }),
    ).toBeVisible();
    const dragFeedback = await page.getByLabel('项目资产内容').evaluate(
      (content, imageBytes) => {
        const target = content.querySelector('[role="list"]')?.parentElement?.parentElement;
        if (!target) throw new Error('找不到项目资产拖放区');
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(
          new File([new Uint8Array(imageBytes)], 'dragged-image.png', { type: 'image/png' }),
        );
        const dragOver = new DragEvent('dragover', {
          bubbles: true,
          cancelable: true,
          dataTransfer,
        });
        target.dispatchEvent(dragOver);
        const result = {
          prevented: dragOver.defaultPrevented,
          dropEffect: dataTransfer.dropEffect,
        };
        target.dispatchEvent(
          new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }),
        );
        return result;
      },
      [...(await readFile(imagePath))],
    );
    await expect(
      page.getByRole('button', { name: 'dragged-image.png', exact: true }),
    ).toBeVisible();
    expect(dragFeedback.prevented).toBe(true);
    expect(await readFile(join(target.rootPath, 'dragged-image.png'))).toEqual(
      await readFile(imagePath),
    );
    await expect(
      page.getByRole('region', { name: '上传队列' }).getByText('已完成').last(),
    ).toBeVisible();
    await page.getByRole('button', { name: '新建文件夹', exact: true }).click();
    await page.getByRole('textbox', { name: '资产名称' }).fill('角色');
    await page.getByRole('button', { name: '确认', exact: true }).click();
    await expect(page.getByRole('button', { name: '角色', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'reference-256.png 的菜单', exact: true }).click();
    await page.getByRole('menuitem', { name: '移动到…', exact: true }).click();
    let dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: '角色', exact: true }).click();
    await dialog.getByRole('button', { name: '确认', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await page.getByRole('textbox', { name: '搜索项目资产' }).fill('reference-256.png');
    await expect(page.getByText('角色/reference-256.png', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'reference-256.png', exact: true }).click();
    dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('img')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.getByRole('textbox', { name: '搜索项目资产' }).fill('');
    await page.getByRole('radio', { name: '宫格视图' }).click();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(720, 560));
    for (const theme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: theme });
      await page.screenshot({
        path: join(screenshots, `assets-${theme}-720.png`),
        animations: 'disabled',
      });
      expect(
        await page
          .locator('main')
          .evaluate((element) => element.scrollWidth <= element.clientWidth),
      ).toBe(true);
    }
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1120, 760));
    for (const theme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: theme });
      await page.screenshot({
        path: join(screenshots, `assets-${theme}-1120.png`),
        animations: 'disabled',
      });
    }
    await openProjectCanvas(page, app);
    await page.getByRole('button', { name: '添加节点', exact: true }).click();
    await page.getByRole('menuitem', { name: '从项目资产添加', exact: true }).click();
    dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: '角色', exact: true }).click();
    await dialog.getByRole('button', { name: 'reference-256.png', exact: true }).click();
    const node = page.locator('.react-flow__node-image');
    await expect(node.locator('img')).toBeVisible();
    await node.click({ button: 'right' });
    await page.getByRole('menuitem', { name: '保存到项目资产', exact: true }).click();
    await expect(page.getByRole('textbox', { name: '保存资产文件名' })).toHaveValue('素材.png');
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(await readFile(join(target.rootPath, '素材.png'))).toEqual(await readFile(imagePath));
    await page
      .getByRole('navigation', { name: '画布面包屑' })
      .getByRole('link', { name: '验收项目', exact: true })
      .click();
    await page.getByRole('tab', { name: '项目资产', exact: true }).click();
    await page.getByRole('button', { name: '素材.png 的菜单', exact: true }).click();
    await page.getByRole('menuitem', { name: '删除', exact: true }).click();
    await page.getByRole('button', { name: '移到回收站', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '素材.png', exact: true })).toHaveCount(0);
    await openProjectCanvas(page, app);
    await expect(page.locator('.react-flow__node-image img')).toBeVisible();
  } finally {
    await app.close();
    await rm(sandbox, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
