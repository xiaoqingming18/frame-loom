import { openProjectCanvas } from './project-canvas.fixture';
import { expect, test, _electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ProjectPageRecord, type CanvasDocument } from '@frame-loom/contracts';

type EngineWindow = Window & {
  frameLoom: { getEngineConnection(): Promise<{ baseUrl: string; token: string }> };
};

const desktop = resolve(fileURLToPath(new URL('..', import.meta.url)));
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aV1cAAAAASUVORK5CYII=',
  'base64',
);

async function stopApp(app: ElectronApplication | undefined) {
  if (!app || app.process().exitCode !== null) return;
  // 失败后的清理绕过未保存保护，只回收本测试创建的主进程与 engine。
  const pid = await app
    .evaluate(
      ({ app }) => app.getAppMetrics().find((metric) => metric.name === 'Frame Loom Engine')?.pid,
    )
    .catch(() => undefined);
  if (pid) {
    try {
      process.kill(pid);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
    }
  }
  await app
    .evaluate(({ BrowserWindow, app }) => {
      for (const window of BrowserWindow.getAllWindows()) window.destroy();
      app.exit();
    })
    .catch(() => {});
}

async function openCanvas(app: ElectronApplication) {
  const page = await app.firstWindow();
  await openProjectCanvas(page, app);
  await expect(page.getByRole('region', { name: '画布编辑区' })).toBeVisible();
  return page;
}
async function readCanvas(page: Page) {
  const value = await page.evaluate(async () => {
    const { baseUrl, token } = await (
      window as unknown as EngineWindow
    ).frameLoom.getEngineConnection();
    return (
      await fetch(
        `${baseUrl}${(JSON.parse(sessionStorage.getItem('project-canvas-fixture')!) as { pagePath: string }).pagePath}`,
        { headers: { Authorization: `Bearer ${token}` } },
      )
    ).json() as Promise<unknown>;
  });
  return ProjectPageRecord.nullable().parse(value);
}
async function rename(page: Page, from: string, to: string) {
  await page.getByText(from, { exact: true }).dblclick();
  await page.getByRole('textbox', { name: '节点名称' }).fill(to);
  await page.getByRole('textbox', { name: '节点名称' }).press('Enter');
}
async function viewport(page: Page) {
  const style = await page.locator('.react-flow__viewport').getAttribute('style');
  const match = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)\s*scale\(([-\d.]+)\)/.exec(style ?? '');
  if (!match) throw new Error(`无效视口变换：${style}`);
  return { x: Number(match[1]), y: Number(match[2]), zoom: Number(match[3]) };
}

test('持久化：自动保存、路由离开、立即关闭与退出后重启，媒体和视图均保留', async ({}, info) => {
  test.setTimeout(120_000);
  const userData = await mkdtemp(join(tmpdir(), 'frame-loom-canvas-persistence-'));
  let app: ElectronApplication | undefined;
  try {
    app = await _electron.launch({ args: [desktop, `--user-data-dir=${userData}`] });
    let page = await openCanvas(app);
    await page
      .getByLabel('上传图片或视频', { exact: true })
      .setInputFiles({ name: '持久化图片.png', mimeType: 'image/png', buffer: png });
    await expect(page.locator('.react-flow__node-image img')).toBeVisible();
    await expect(page.getByRole('status', { name: '画布保存状态' })).toHaveText('已保存');
    const first = (await readCanvas(page))!;
    expect(first.revision).toBeGreaterThanOrEqual(1);
    expect(first.document.nodes).toHaveLength(1);
    const media = first.document.nodes[0].data;
    const title = first.document.nodes[0].title!;
    const pane = page.locator('.react-flow__pane');
    const box = (await pane.boundingBox())!;
    await page.mouse.move(box.x + 80, box.y + 120);
    await page.mouse.down({ button: 'middle' });
    await page.mouse.move(box.x + 140, box.y + 150, { steps: 8 });
    await page.mouse.up({ button: 'middle' });
    await page.getByRole('button', { name: '缩放比例', exact: true }).click();
    await page.getByRole('menuitem', { name: '75%', exact: true }).click();
    await page.getByRole('button', { name: '隐藏小地图', exact: true }).click();
    await page.getByRole('button', { name: '连线显示', exact: true }).click();
    await page.getByRole('menuitemradio', { name: '隐藏', exact: true }).click();
    await expect(page.getByRole('status', { name: '画布保存状态' })).toHaveText('已保存');
    const savedView = (await readCanvas(page))!.view!;
    expect(savedView).toMatchObject({
      minimap: false,
      edgeDisplay: 'hidden',
      viewport: { zoom: 0.75 },
    });
    expect(savedView.viewport.x).not.toBe(0);
    expect((await readCanvas(page))!.revision).toBe(first.revision);

    await rename(page, title, '离开路由前保存');
    await page.getByRole('link', { name: '项目库', exact: true }).first().click();
    await expect(page.getByRole('region', { name: '画布编辑区' })).toHaveCount(0);
    expect((await readCanvas(page))!.document.nodes[0].title).toBe('离开路由前保存');
    await openProjectCanvas(page, app);
    await expect(page.getByText('离开路由前保存', { exact: true })).toBeVisible();
    await rename(page, '离开路由前保存', '关闭窗口前保存');
    const closed = app.waitForEvent('close');
    await page.getByRole('button', { name: '关闭窗口' }).click();
    await closed;
    app = undefined;

    app = await _electron.launch({ args: [desktop, `--user-data-dir=${userData}`] });
    page = await openCanvas(app);
    await expect(page.getByText('关闭窗口前保存', { exact: true })).toBeVisible();
    await expect(page.locator('.react-flow__node-image img')).toBeVisible();
    expect((await readCanvas(page))!.document.nodes[0].data).toEqual(media);
    expect((await readCanvas(page))!.view).toEqual(savedView);
    const restored = await viewport(page);
    expect(restored.x).toBeCloseTo(savedView.viewport.x, 2);
    expect(restored.y).toBeCloseTo(savedView.viewport.y, 2);
    expect(restored.zoom).toBeCloseTo(savedView.viewport.zoom, 3);
    await expect(page.locator('.react-flow__minimap')).toHaveCount(0);
    for (const theme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: theme });
      await page.screenshot({ path: info.outputPath(`canvas-saved-${theme}.png`) });
    }
    await page.getByText('关闭窗口前保存', { exact: true }).dblclick();
    await page.getByRole('textbox', { name: '节点名称' }).fill('退出应用前保存');
    const quit = app.waitForEvent('close');
    await app.evaluate(({ app }) => app.quit());
    await quit;
    app = undefined;
    app = await _electron.launch({ args: [desktop, `--user-data-dir=${userData}`] });
    page = await openCanvas(app);
    await expect(page.getByText('退出应用前保存', { exact: true })).toBeVisible();
  } finally {
    await stopApp(app);
    await rm(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test('持久化故障：409 不覆盖、导出救援与重新加载；引擎退出保留画布并保护离开', async ({}, info) => {
  test.setTimeout(120_000);
  const userData = await mkdtemp(join(tmpdir(), 'frame-loom-canvas-conflict-'));
  let app: ElectronApplication | undefined = await _electron.launch({
    args: [desktop, `--user-data-dir=${userData}`],
  });
  try {
    const page = await openCanvas(app);
    await page
      .getByLabel('上传图片或视频', { exact: true })
      .setInputFiles({ name: '冲突图片.png', mimeType: 'image/png', buffer: png });
    await expect(page.locator('.react-flow__node-image img')).toBeVisible();
    await expect(page.getByRole('status', { name: '画布保存状态' })).toHaveText('已保存');
    const original = (await readCanvas(page))!;
    const remote = {
      ...original.document,
      nodes: [{ ...original.document.nodes[0], title: '其他窗口的更改' }],
    };
    const externalStatus = await page.evaluate(
      async (body) => {
        const { baseUrl, token } = await (
          window as unknown as EngineWindow
        ).frameLoom.getEngineConnection();
        return (
          await fetch(
            `${baseUrl}${(JSON.parse(sessionStorage.getItem('project-canvas-fixture')!) as { pagePath: string }).pagePath}`,
            {
              method: 'PUT',
              headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
            },
          )
        ).status;
      },
      { revision: original.revision, document: remote },
    );
    expect(externalStatus).toBe(200);
    await rename(page, original.document.nodes[0].title!, '本地未保存内容');
    await page.getByRole('link', { name: '项目库', exact: true }).first().click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('button', { name: '留在画布' }).click();
    await expect(page.getByRole('alert')).toContainText('创作页已被修改');
    const exportPath = join(userData, 'rescue.json');
    await app.evaluate(({ session }, path) => {
      session.defaultSession.once('will-download', (_event, item) => item.setSavePath(path));
    }, exportPath);
    await page.getByRole('button', { name: '导出当前画布 JSON' }).click();
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
    expect(exported.nodes[0].title).toBe('本地未保存内容');
    expect((await readCanvas(page))!.document).toEqual(remote);
    for (const theme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: theme });
      await page.screenshot({ path: info.outputPath(`canvas-conflict-${theme}.png`) });
    }
    await page.getByRole('button', { name: '重新加载' }).click();
    await expect(page.getByText('其他窗口的更改', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '撤销', exact: true })).toBeDisabled();
    await page.evaluate(() => Object.assign(globalThis, { canvasNotReloaded: true }));
    const enginePid = await app.evaluate(
      ({ app }) => app.getAppMetrics().find((metric) => metric.name === 'Frame Loom Engine')?.pid,
    );
    expect(enginePid).toBeDefined();
    process.kill(enginePid!);
    await expect(page.getByRole('alert')).toContainText('本地引擎已退出');
    expect(await page.evaluate(() => 'canvasNotReloaded' in globalThis)).toBe(true);
    await rename(page, '其他窗口的更改', '引擎退出后的本地内容');
    await page.getByRole('button', { name: '关闭窗口' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('button', { name: '留在画布' }).click();
    await expect(page.locator('[role="dialog"]')).toHaveCount(0);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(720, 560));
    for (const theme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: theme });
      const section = (await page
        .getByRole('region', { name: '项目画布', exact: true })
        .boundingBox())!;
      const button = (await page.getByRole('button', { name: '导出当前画布 JSON' }).boundingBox())!;
      expect(button.x + button.width).toBeLessThanOrEqual(section.x + section.width);
      await page.screenshot({ path: info.outputPath(`canvas-error-minimum-${theme}.png`) });
    }
    await page.getByRole('button', { name: '关闭窗口' }).click();
    const closed = app.waitForEvent('close');
    await page.getByRole('button', { name: '放弃更改并离开' }).click();
    await closed;
    app = undefined;
  } finally {
    await stopApp(app);
    await rm(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
