import { expect, test, _electron } from '@playwright/test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CanvasDocument } from '@frame-loom/contracts';

const desktop = resolve(fileURLToPath(new URL('..', import.meta.url)));

test('分组与整理：菜单、锁定、层级、JSON 往返与一步撤销', async ({}, info) => {
  test.setTimeout(120_000);
  const userData = await mkdtemp(join(tmpdir(), 'frame-loom-canvas-organize-'));
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
    const pane = page.locator('.react-flow__pane');
    const imported: CanvasDocument = {
      schemaVersion: 1,
      nodes: ['镜头10', '镜头2'].map((title, index) => ({
        id: `n${index}`,
        type: 'image',
        typeVersion: 1,
        title,
        position: { x: 140 + index * 450, y: 220 + index * 100 },
        size: { width: 280, height: 180 },
        data: { versions: [], activeVersion: 0, prompt: '', inputOrder: [] },
      })),
      edges: [],
    };
    const input = page.getByLabel('导入画布 JSON', { exact: true });
    await pane.click({ button: 'right', position: { x: 80, y: 100 } });
    await expect(page.getByRole('menuitem', { name: '导出 JSON', exact: true })).toBeVisible();
    const chooser = page.waitForEvent('filechooser');
    await page
      .getByRole('menuitem', { name: '导入 JSON（替换画布，可撤销）', exact: true })
      .click();
    await (
      await chooser
    ).setFiles({
      name: 'canvas.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(imported)),
    });
    await expect(page.locator('.react-flow__node-image')).toHaveCount(2);
    await editor.focus();
    await page.keyboard.press('Control+a');
    await page.keyboard.press('Control+g');
    const group = page.locator('.react-flow__node-group');
    await expect(group).toHaveCount(1);
    const originalWidth = await group.evaluate((node) => (node as HTMLElement).style.width);
    const handle = (await group
      .locator('.react-flow__resize-control.handle.bottom.right')
      .boundingBox())!;
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(handle.x + 60, handle.y + 40, { steps: 10 });
    await page.mouse.up();
    await expect
      .poll(() => group.evaluate((node) => (node as HTMLElement).style.width))
      .not.toBe(originalWidth);
    await page.getByRole('button', { name: '撤销', exact: true }).click();
    await expect(group).toHaveCSS('width', originalWidth);
    const snapshot = async () => {
      await editor.focus();
      await page.keyboard.press('Control+a');
      return editor.evaluate((element) => {
        const clipboardData = new DataTransfer();
        element.dispatchEvent(
          new ClipboardEvent('copy', { clipboardData, bubbles: true, cancelable: true }),
        );
        return JSON.parse(
          clipboardData.getData('text/plain').split('frame-loom-canvas/v1:')[1],
        ) as { nodes: CanvasDocument['nodes'] };
      });
    };
    const moveMember = async (x: number, y: number) => {
      const member = page.locator('.react-flow__node-image[data-id="n0"]');
      await editor.focus();
      await page.keyboard.press('Escape');
      await member.click({ position: { x: 30, y: 25 } });
      const rect = (await member.boundingBox())!;
      await page.mouse.move(rect.x + rect.width / 2, rect.y + 25);
      await page.mouse.down();
      await page.mouse.move(x, y, { steps: 12 });
      await page.mouse.up();
    };
    const region = (await editor.boundingBox())!;
    await moveMember(region.x + region.width - 150, region.y + region.height - 150);
    expect((await snapshot()).nodes.find((node) => node.id === 'n0')?.parentId).toBeUndefined();
    const groupBox = (await group.boundingBox())!;
    await moveMember(groupBox.x + 220, groupBox.y + 180);
    expect((await snapshot()).nodes.find((node) => node.id === 'n0')?.parentId).toBeTruthy();
    await page.getByRole('button', { name: '撤销', exact: true }).click();
    expect((await snapshot()).nodes.find((node) => node.id === 'n0')?.parentId).toBeUndefined();
    await page.getByRole('button', { name: '重做', exact: true }).click();
    expect((await snapshot()).nodes.find((node) => node.id === 'n0')?.parentId).toBeTruthy();
    await editor.focus();
    await page.keyboard.press('Escape');
    await group.click({ position: { x: 12, y: 12 } });
    await editor.focus();
    await page.keyboard.press('F2');
    await page.getByRole('textbox', { name: '节点名称' }).fill('参考镜头');
    await page.getByRole('textbox', { name: '节点名称' }).press('Enter');
    await page.getByRole('radio', { name: '蓝色', exact: true }).click();
    await expect(group.locator('.canvas-group')).toHaveClass(/canvas-group-blue/);
    await page.getByRole('radio', { name: '蓝色', exact: true }).press('ArrowRight');
    await expect(group.locator('.canvas-group')).toHaveClass(/canvas-group-purple/);
    await group.click({ button: 'right', position: { x: 12, y: 12 } });
    await page.getByRole('menuitem', { name: '适应内容', exact: true }).click();

    await page.getByRole('button', { name: '按布局整理选中节点', exact: true }).click();
    await page.getByRole('menuitemradio', { name: '标题顺序', exact: true }).click();
    for (const label of ['宫格', '水平', '垂直', '按类型']) {
      const before = await page
        .locator('.react-flow__node-image')
        .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('style')));
      await page.getByRole('button', { name: '按布局整理选中节点', exact: true }).click();
      await page.getByRole('menuitem', { name: label, exact: true }).click();
      await page.getByRole('button', { name: '撤销', exact: true }).click();
      await expect
        .poll(() =>
          page
            .locator('.react-flow__node-image')
            .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('style'))),
        )
        .toEqual(before);
    }
    await group.click({ button: 'right', position: { x: 12, y: 12 } });
    await page.getByRole('menuitem', { name: '锁定', exact: true }).click();
    const lockedStyle = await group.getAttribute('style');
    await editor.focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Delete');
    await expect(group).toHaveCount(1);
    await expect(group).toHaveAttribute('style', lockedStyle!);
    await group.click({ button: 'right', position: { x: 12, y: 12 } });
    await page.getByRole('menuitem', { name: '解除锁定', exact: true }).click();

    await editor.focus();
    await page.keyboard.press('Shift+1');
    await expect.poll(async () => (await group.boundingBox())!.width).toBeLessThan(1100);

    for (const theme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: theme });
      await page.screenshot({ path: info.outputPath(`canvas-organize-${theme}.png`) });
    }

    const exportPath = join(userData, 'export.json');
    await app.evaluate(({ session }, path) => {
      session.defaultSession.once('will-download', (_event, item) => item.setSavePath(path));
    }, exportPath);
    await pane.click({ button: 'right', position: { x: 80, y: 100 } });
    await page.getByRole('menuitem', { name: '导出 JSON', exact: true }).click();
    await expect
      .poll(async () => {
        try {
          return JSON.parse(await readFile(exportPath, 'utf8')) as CanvasDocument;
        } catch {
          return null;
        }
      })
      .not.toBeNull();
    const exported = JSON.parse(await readFile(exportPath, 'utf8')) as CanvasDocument;
    expect(exported.nodes.find((node) => node.type === 'group')).toMatchObject({
      title: '参考镜头',
      data: { color: 'purple' },
    });
    expect(exported.nodes.filter((node) => node.parentId)).toHaveLength(2);
    await editor.focus();
    await page.keyboard.press('Control+a');
    await page.keyboard.press('Control+Shift+g');
    await expect(group).toHaveCount(0);
    await editor.focus();
    await page.keyboard.press('Escape');
    const first = page.locator('.react-flow__node-image[data-id="n0"]');
    await first.click({ button: 'right', position: { x: 8, y: 8 } });
    await page.getByRole('menuitem', { name: '置于顶层', exact: true }).click();
    await expect(first).toHaveCSS('z-index', '2');
    await first.click({ button: 'right', position: { x: 8, y: 8 } });
    await page.getByRole('menuitem', { name: '置于底层', exact: true }).click();
    await expect(first).toHaveCSS('z-index', '1');
    await input.setInputFiles({
      name: 'roundtrip.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(exported)),
    });
    await expect(group).toHaveCount(1);
    await page.getByRole('button', { name: '撤销', exact: true }).click();
    await expect(group).toHaveCount(0);
    await input.setInputFiles({
      name: 'invalid.json',
      mimeType: 'application/json',
      buffer: Buffer.from('{'),
    });
    await expect(editor.getByRole('status')).toContainText('JSON 格式无效');
    await expect(page.locator('.react-flow__node-image')).toHaveCount(2);
    await input.setInputFiles({
      name: 'minimum.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(exported)),
    });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(720, 560));
    await editor.focus();
    await page.keyboard.press('Shift+1');
    await expect(page.locator('.react-flow__minimap')).toHaveCount(0);
    await expect(editor.getByRole('status')).toBeEmpty();
    await expect
      .poll(async () => {
        const frame = (await group.boundingBox())!;
        const area = (await editor.boundingBox())!;
        return frame.x >= area.x && frame.x + frame.width <= area.x + area.width;
      })
      .toBe(true);
    for (const theme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: theme });
      const area = (await editor.boundingBox())!;
      for (const label of ['画布工具', '视图与整理']) {
        const toolbar = (await page.getByRole('toolbar', { name: label }).boundingBox())!;
        expect(toolbar.x).toBeGreaterThanOrEqual(area.x);
        expect(toolbar.x + toolbar.width).toBeLessThanOrEqual(area.x + area.width);
      }
      await page.screenshot({ path: info.outputPath(`canvas-organize-minimum-${theme}.png`) });
    }
    await input.setInputFiles({
      name: 'overview.json',
      mimeType: 'application/json',
      buffer: Buffer.from(
        JSON.stringify({
          schemaVersion: 1,
          nodes: Array.from({ length: 51 }, (_, index) => ({
            ...imported.nodes[0],
            id: `overview-${index}`,
            position: { x: index * 600, y: 0 },
          })),
          edges: [],
        }),
      ),
    });
    await editor.focus();
    await page.keyboard.press('Shift+1');
    await expect(page.locator('.react-flow__node-image')).toHaveCount(51);
    await expect(page.getByLabel('生成提示词')).toHaveCount(0);
    await page.keyboard.press('Shift+0');
    await expect(page.locator('.react-flow__viewport')).toHaveAttribute('style', /scale\(1\)/);
    await expect.poll(() => page.locator('.react-flow__node-image').count()).toBeLessThan(51);
    await page.locator('.react-flow__node-image').first().focus();
    await page.locator('.react-flow__node-image').first().press('Enter');
    await expect.poll(() => page.getByLabel('生成提示词').count()).toBeGreaterThan(0);
    await expect(page.locator('.react-flow__viewport')).toHaveAttribute('style', /scale\(1\)/);
    await expect(page.getByRole('status', { name: '画布保存状态' })).toHaveText('已保存');
    expect(errors).toEqual([]);
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
  }
});
