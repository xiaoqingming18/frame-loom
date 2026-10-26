import { openProjectCanvas } from './project-canvas.fixture';
import { expect, test, _electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

async function viewport(page: Page) {
  const style = await page.locator('.react-flow__viewport').getAttribute('style');
  const match = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)\s*scale\(([-\d.]+)\)/.exec(style ?? '');
  if (!match) throw new Error(`无效视口变换：${style}`);
  return { x: Number(match[1]), y: Number(match[2]), zoom: Number(match[3]) };
}

async function pan(
  page: Page,
  x: number,
  y: number,
  dx: number,
  dy: number,
  button: 'left' | 'middle' = 'left',
) {
  await page.mouse.move(x, y);
  await page.mouse.down({ button });
  await page.mouse.move(x + dx, y + dy, { steps: 8 });
  await page.mouse.up({ button });
}

test('画布骨架：主题、最小窗口、工具焦点与视口快捷键', async ({}, info) => {
  const userData = await mkdtemp(join(tmpdir(), 'frame-loom-canvas-shell-'));
  const desktop = resolve(fileURLToPath(new URL('..', import.meta.url)));
  let app: ElectronApplication | undefined;
  try {
    app = await _electron.launch({ args: [desktop, `--user-data-dir=${userData}`] });
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (/Content Security Policy|Refused to|\[React Flow\]/.test(message.text()))
        errors.push(message.text());
    });
    await openProjectCanvas(page, app);
    const editor = page.getByRole('region', { name: '画布编辑区' });
    const pane = page.locator('.react-flow__pane');
    await expect(editor).toBeVisible();
    await expect(page.getByRole('region', { name: '项目画布' })).toBeVisible();
    await expect(page.locator('main')).toHaveClass(/overflow-hidden/);
    await expect(page.locator('main')).not.toHaveClass(/canvas-grid/);

    for (const theme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: theme });
      const toolbar = (await page.getByRole('toolbar', { name: '视图与整理' }).boundingBox())!;
      const minimap = (await page.locator('.react-flow__minimap').boundingBox())!;
      expect(minimap.y).toBeGreaterThanOrEqual(toolbar.y + toolbar.height + 8);
      expect(Math.round(minimap.width)).toBe(180);
      expect(Math.round(minimap.height)).toBe(120);
      await page.screenshot({ path: info.outputPath(`canvas-shell-${theme}.png`) });
    }

    const box = (await pane.boundingBox())!;
    const x = box.x + 110;
    const y = box.y + 190;
    await pane.click({ position: { x: 100, y: 180 } });
    await expect(editor).toBeFocused();
    await page.keyboard.press('b');
    await expect(page.getByRole('button', { name: '框选', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    const before = await viewport(page);
    await pan(page, x, y, 50, 35);
    expect(await viewport(page)).toEqual(before);
    await page.keyboard.down('Space');
    await expect(page.locator('.react-flow.canvas-hand')).toHaveCount(1);
    await pan(page, x, y, 60, 40);
    await page.keyboard.up('Space');
    await expect(page.locator('.react-flow.canvas-hand')).toHaveCount(0);
    const moved = await viewport(page);
    expect(moved.x - before.x).toBeCloseTo(60, 0);
    expect(moved.y - before.y).toBeCloseTo(40, 0);
    await expect(page.getByRole('button', { name: '框选', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await pan(page, x, y, 40, 0, 'middle');
    expect((await viewport(page)).x).toBeCloseTo(moved.x + 40, 0);

    await page.keyboard.press('h');
    await expect(page.getByRole('button', { name: '抓手', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await page.keyboard.press('v');
    await expect(page.locator('button[aria-label="指针"]')).toHaveAttribute('aria-pressed', 'true');
    await page.mouse.move(x, y);
    await page.mouse.wheel(0, -200);
    await expect.poll(async () => (await viewport(page)).zoom).toBeGreaterThan(1);
    await page.keyboard.press('Shift+0');
    await expect.poll(async () => (await viewport(page)).zoom).toBeCloseTo(1, 3);
    await page.getByRole('button', { name: '缩放比例', exact: true }).click();
    await page.getByRole('menuitem', { name: '400%', exact: true }).click();
    await expect.poll(async () => (await viewport(page)).zoom).toBeCloseTo(4, 3);
    await pane.click({ position: { x: 20, y: 20 } });
    await page.mouse.move(x, y);
    await page.mouse.wheel(0, -500);
    await expect.poll(async () => (await viewport(page)).zoom).toBeLessThanOrEqual(4);
    await page.getByRole('button', { name: '缩放比例', exact: true }).click();
    await page.getByRole('menuitem', { name: '10%', exact: true }).click();
    await expect.poll(async () => (await viewport(page)).zoom).toBeCloseTo(0.1, 3);
    await pane.click({ position: { x: 20, y: 20 } });
    await page.keyboard.press('Shift+0');
    await expect.poll(async () => (await viewport(page)).zoom).toBeCloseTo(1, 3);
    await page.keyboard.press('m');
    await expect(page.locator('.react-flow__minimap')).toHaveCount(0);
    await page.keyboard.press('m');
    await expect(page.locator('.react-flow__minimap')).toBeVisible();
    await page.keyboard.press('n');
    await expect(page.getByRole('menuitem', { name: '图片', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menuitem', { name: '图片', exact: true })).toHaveCount(0);

    // Portal 菜单打开时，其按键不应切换背景画布工具。
    await page.getByRole('button', { name: '连线显示', exact: true }).click();
    await page.keyboard.press('b');
    await expect(page.locator('button[aria-label="指针"]')).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: '快捷键帮助', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('h');
    await expect(page.locator('button[aria-label="指针"]')).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(720, 560));
    await expect
      .poll(async () => Math.round((await editor.boundingBox())!.width))
      .toBeLessThan(480);
    await expect(page.locator('.react-flow__minimap')).toHaveCount(0);
    for (const theme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: theme });
      const canvasBox = (await editor.boundingBox())!;
      for (const name of ['画布工具', '视图与整理']) {
        const controls = (await page.getByRole('toolbar', { name }).boundingBox())!;
        expect(controls.x).toBeGreaterThanOrEqual(canvasBox.x);
        expect(controls.x + controls.width).toBeLessThanOrEqual(canvasBox.x + canvasBox.width);
      }
      await page.screenshot({ path: info.outputPath(`canvas-shell-minimum-${theme}.png`) });
    }
    await page.getByRole('link', { name: '项目库', exact: true }).first().click();
    await expect(page.locator('main')).toHaveClass(/canvas-grid/);
    await expect(page.locator('main')).toHaveClass(/overflow-y-auto/);
    expect(errors).toEqual([]);
  } finally {
    await app?.close();
    await rm(userData, { recursive: true, force: true });
  }
});
