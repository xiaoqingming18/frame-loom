import { test, expect, _electron, type ElectronApplication } from '@playwright/test';
import { access, copyFile, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

test('项目库与创作页生命周期、偏好重启保留及明暗最小窗口', async () => {
  const sandbox = await mkdtemp(join(tmpdir(), 'frame-project-library-e2e-'));
  const userData = join(sandbox, 'user-data');
  const location = join(sandbox, 'projects');
  await mkdir(location);
  const desktop = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const screenshots = resolve(desktop, '../../.cache/project-library');
  await mkdir(screenshots, { recursive: true });
  let app: ElectronApplication | undefined;
  try {
    app = await _electron.launch({ args: [desktop, `--user-data-dir=${userData}`] });
    const page = await app.firstWindow();
    await page.emulateMedia({ colorScheme: null });
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.getByRole('link', { name: '项目库', exact: true }).click();
    await expect(page.getByText('还没有项目', { exact: true })).toBeVisible();
    await app.evaluate(({ dialog }, location) => {
      dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [location] });
    }, location);
    await page.getByRole('button', { name: '新建项目', exact: true }).last().click();
    let dialog = page.getByRole('dialog');
    await dialog.getByRole('textbox', { name: '项目名称', exact: true }).fill('城市漫游');
    await dialog.getByRole('button', { name: '更改' }).click();
    await dialog.getByRole('button', { name: '创建项目' }).click();
    await expect(page.getByRole('heading', { name: '城市漫游', exact: true })).toBeVisible();
    const root = join(location, '城市漫游');
    const manifest = JSON.parse(await readFile(join(root, '.frameloom/project.json'), 'utf8')) as {
      id: string;
    };
    await copyFile(join(desktop, 'e2e/fixtures/reference-256.png'), join(root, '参考.png'));
    const connection = await page.evaluate<{ baseUrl: string; token: string }>(
      'window.frameLoom.getEngineConnection()',
    );
    const upload = await fetch(`${connection.baseUrl}/projects/${manifest.id}/media`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${connection.token}`,
        'Content-Type': 'application/octet-stream',
      },
      body: new Uint8Array(await readFile(join(root, '参考.png'))),
    });
    expect(upload.status).toBe(201);
    const media = (await upload.json()) as { sha256: string };
    for (const source of [
      `frame-project://${manifest.id}/assets/${encodeURIComponent('参考.png')}`,
      `frame-project://${manifest.id}/media/${media.sha256}`,
    ]) {
      const width = await page.evaluate(
        (source) =>
          new Promise<number>((resolve, reject) => {
            const image = new Image();
            image.onload = () => resolve(image.naturalWidth);
            image.onerror = () => reject(new Error('项目图片加载失败'));
            image.src = source;
          }),
        source,
      );
      expect(width).toBe(256);
    }
    await page.getByRole('tab', { name: '创作页', exact: true }).click();
    await page.getByRole('button', { name: '新建创作页' }).click();
    dialog = page.getByRole('dialog');
    await dialog.getByRole('textbox', { name: '创作页名称' }).fill('第一集');
    await dialog.getByRole('button', { name: '确认' }).click();
    await expect(page.getByRole('region', { name: '画布编辑区' })).toBeVisible();
    await page
      .getByRole('navigation', { name: '画布面包屑' })
      .getByRole('link', { name: '城市漫游' })
      .click();
    await page.getByRole('button', { name: '展开 城市漫游' }).click();
    await expect(
      page.getByRole('navigation', { name: '项目树' }).getByRole('link', { name: '第一集' }),
    ).toBeVisible();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(720, 560));
    for (const theme of ['light', 'dark'] as const) {
      await page.evaluate(async (theme) => {
        await (
          window as unknown as { frameLoom: { theme: { set(value: string): Promise<unknown> } } }
        ).frameLoom.theme.set(theme);
      }, theme);
      await expect
        .poll(() => page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches))
        .toBe(theme === 'dark');
      await page.screenshot({
        path: join(screenshots, `detail-${theme}-720.png`),
        animations: 'disabled',
      });
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
        .toBe(true);
      const tabs = page.getByRole('tab', { name: '剧集', exact: true });
      await tabs.focus();
      await page.keyboard.press('ArrowRight');
      await expect(page.getByRole('button', { name: '新建创作页' })).toBeVisible();
      await page.getByRole('tab', { name: '项目资产', exact: true }).click();
      await expect(page.getByLabel('项目资产内容')).toBeVisible();
      await page.keyboard.press('ArrowLeft');
      await page.getByRole('link', { name: '项目库', exact: true }).first().click();
      await expect(page.getByRole('article', { name: '城市漫游' })).toBeVisible();
      await page.screenshot({
        path: join(screenshots, `library-${theme}-720.png`),
        animations: 'disabled',
      });
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].setSize(1120, 760),
      );
      await page.screenshot({
        path: join(screenshots, `library-${theme}-1120.png`),
        animations: 'disabled',
      });
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(720, 560));
      await page.getByRole('button', { name: '新建项目', exact: true }).last().click();
      await expect(page.getByRole('dialog', { name: '新建本地项目' })).toBeVisible();
      await page.screenshot({
        path: join(screenshots, `create-${theme}-720.png`),
        animations: 'disabled',
      });
      await page.keyboard.press('Escape');
      await page.getByRole('link', { name: '打开项目 城市漫游' }).click();
    }
    await page.getByRole('link', { name: '项目库', exact: true }).first().click();
    await page.getByRole('button', { name: '项目排序：最近修改' }).click();
    await page.getByRole('menuitemradio', { name: '名称', exact: true }).click();
    await page.getByRole('button', { name: '城市漫游 的菜单' }).click();
    await page.getByRole('menuitem', { name: '重命名', exact: true }).click();
    dialog = page.getByRole('dialog');
    await dialog.getByRole('textbox', { name: '项目名称', exact: true }).fill('城市漫游 2');
    await dialog.getByRole('button', { name: '确认' }).click();
    await expect(page.getByRole('article', { name: '城市漫游 2' })).toBeVisible();
    await access(root);
    expect(pageErrors).toEqual([]);
    await app.close();
    app = undefined;
    app = await _electron.launch({ args: [desktop, `--user-data-dir=${userData}`] });
    const reopened = await app.firstWindow();
    await reopened.getByRole('link', { name: '项目库', exact: true }).click();
    await expect(reopened.getByRole('button', { name: '项目排序：名称' })).toBeVisible();
    await expect(reopened.getByRole('article', { name: '城市漫游 2' })).toBeVisible();
    const preferences = JSON.parse(await readFile(join(userData, 'preferences.json'), 'utf8')) as {
      projectSort: string;
      projectLocation: string;
      theme: string;
    };
    expect(preferences).toMatchObject({
      projectSort: 'name',
      projectLocation: location,
      theme: 'dark',
    });
    await reopened.getByRole('button', { name: '城市漫游 2 的菜单' }).click();
    await reopened.getByRole('menuitem', { name: '删除', exact: true }).click();
    const deletion = reopened.getByRole('dialog');
    await expect(deletion.getByRole('radio', { name: '同时将项目文件夹移到回收站' })).toBeChecked();
    await deletion.getByRole('button', { name: '确认' }).click();
    await expect(reopened.getByText('还没有项目', { exact: true })).toBeVisible();
    await expect(access(root)).rejects.toThrow();
    expect(manifest.id).toMatch(/^[a-f0-9-]{36}$/);
  } finally {
    await app?.close();
    await rm(sandbox, { recursive: true, force: true });
  }
});
