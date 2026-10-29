import {
  expect,
  test,
  _electron,
  type ElectronApplication,
  type Locator,
  type Page,
} from '@playwright/test';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ProjectPageRecord, ProjectTag, type CanvasDocument } from '@frame-loom/contracts';
import { openProjectCanvas } from './project-canvas.fixture';

const desktop = resolve(fileURLToPath(new URL('..', import.meta.url)));
const screenshots = resolve(desktop, '../../.cache/project-tags');

async function api(page: Page, path: string, method = 'GET', body?: unknown) {
  return page.evaluate(
    async ({ path, method, body }) => {
      const { baseUrl, token } = await (
        window as unknown as {
          frameLoom: { getEngineConnection(): Promise<{ baseUrl: string; token: string }> };
        }
      ).frameLoom.getEngineConnection();
      const response = await fetch(baseUrl + path, {
        method,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (!response.ok) throw new Error(`${path}: ${response.status} ${await response.text()}`);
      return response.json() as Promise<unknown>;
    },
    { path, method, body },
  );
}

async function openPage(page: Page, name: string) {
  await page.getByRole('link', { name: '项目库', exact: true }).first().click();
  await page.getByRole('link', { name: '打开项目 验收项目', exact: true }).click();
  await page.getByRole('tab', { name: '创作页', exact: true }).click();
  await page.getByRole('heading', { name, exact: true }).click();
  await expect(page.getByRole('region', { name: '画布编辑区' })).toBeVisible();
  await expect(page.getByRole('status', { name: '画布保存状态' })).toHaveText('已保存');
}

async function openTags(page: Page, nodeId: string) {
  await page.locator(`.react-flow__node[data-id="${nodeId}"]`).click({ button: 'right' });
  const item = page.getByRole('menuitem', { name: '标签', exact: true });
  await expect(item).toBeEnabled();
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowDown');
  await expect(item).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: '画布标签', exact: true })).toBeVisible();
}

async function tabTo(page: Page, target: Locator) {
  for (let step = 0; step < 50; step++) {
    if (await target.evaluate((element) => element === document.activeElement)) return;
    await page.keyboard.press('Tab');
  }
  await expect(target).toBeFocused();
}

async function capture(page: Page, app: ElectronApplication, state: string, dialog: Locator) {
  await page.emulateMedia({ colorScheme: null });
  for (const [width, height] of [
    [1120, 760],
    [720, 560],
  ]) {
    await app.evaluate(
      ({ BrowserWindow }, [width, height]) => {
        BrowserWindow.getAllWindows()[0].setSize(width, height);
      },
      [width, height],
    );
    for (const theme of ['light', 'dark'] as const) {
      await page.evaluate(async (theme) => {
        await (
          window as unknown as {
            frameLoom: { theme: { set(value: string): Promise<unknown> } };
          }
        ).frameLoom.theme.set(theme);
      }, theme);
      await expect
        .poll(() => page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches))
        .toBe(theme === 'dark');
      await expect(dialog).toBeVisible();
      await expect
        .poll(async () => {
          const bounds = await dialog.boundingBox();
          const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
          return (
            !!bounds &&
            bounds.x >= 0 &&
            bounds.y >= 0 &&
            bounds.x + bounds.width <= viewport.width + 1 &&
            bounds.y + bounds.height <= viewport.height + 1
          );
        })
        .toBe(true);
      await page.screenshot({
        path: join(screenshots, `${state}-${theme}-${width}.png`),
        animations: 'disabled',
      });
    }
  }
}

test('项目标签：跨页改名、锁定引用、全部改派与重启徽标，明暗小窗口和键盘路径', async () => {
  test.setTimeout(180_000);
  const userData = await mkdtemp(join(tmpdir(), 'frame-loom-project-tags-'));
  await mkdir(screenshots, { recursive: true });
  let app: ElectronApplication | undefined;
  const pageErrors: string[] = [];
  try {
    app = await _electron.launch({ args: [desktop, `--user-data-dir=${userData}`] });
    let page = await app.firstWindow();
    page.on('pageerror', (error) => pageErrors.push(error.message));
    const target = await openProjectCanvas(page, app);
    await page.getByLabel('上传图片或视频', { exact: true }).setInputFiles({
      name: '用于检查标题优先截断与标签徽标的长名称参考图片.png',
      mimeType: 'image/png',
      buffer: await readFile(new URL('./fixtures/reference-256.png', import.meta.url)),
    });
    await expect(page.locator('.react-flow__node-image img')).toBeVisible();
    await expect(page.getByRole('status', { name: '画布保存状态' })).toHaveText('已保存');
    const first = ProjectPageRecord.parse(await api(page, target.pagePath));
    const firstId = first.document.nodes[0].id;
    const second = (await api(page, `/projects/${target.projectId}/pages`, 'POST', {
      name: '第二创作页',
    })) as { id: string };
    const secondPath = `/projects/${target.projectId}/pages/${second.id}`;
    const secondRecord = ProjectPageRecord.parse(await api(page, secondPath));
    await api(page, secondPath, 'PUT', {
      revision: secondRecord.revision,
      document: {
        schemaVersion: 1,
        nodes: [
          {
            ...first.document.nodes[0],
            id: 'second-image',
            title: '第二页图片',
            position: { x: 100, y: 100 },
          },
        ],
        edges: [],
      } satisfies CanvasDocument,
    });
    await openTags(page, firstId);
    let card = page.getByRole('dialog', { name: '画布标签', exact: true });
    await card.getByRole('textbox', { name: '标签名', exact: true }).fill('候选');
    await card.getByRole('button', { name: '添加', exact: true }).click();
    await expect(card.getByRole('button', { name: '候选', exact: true })).toBeVisible();
    await card.getByRole('button', { name: '候选', exact: true }).click();
    await expect(page.locator('.canvas-tag-badge')).toHaveText('候选');
    await openPage(page, '第二创作页');
    await openTags(page, 'second-image');
    await page.getByRole('button', { name: '候选', exact: true }).click();
    await expect(page.locator('.canvas-tag-badge')).toHaveText('候选');
    await page.locator('.react-flow__node[data-id="second-image"]').click({ button: 'right' });
    await page.getByRole('menuitem', { name: '锁定', exact: true }).click();
    await page.locator('.react-flow__node[data-id="second-image"]').click({ button: 'right' });
    await expect(page.getByRole('menuitem', { name: '标签', exact: true })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await page.screenshot({ path: join(screenshots, 'locked-menu.png'), animations: 'disabled' });
    await page.keyboard.press('Escape');

    await openPage(page, '验收创作页');
    await openTags(page, firstId);
    card = page.getByRole('dialog', { name: '画布标签', exact: true });
    await tabTo(page, card.getByRole('button', { name: '编辑标签 候选', exact: true }));
    await page.keyboard.press('Enter');
    await expect(card.getByRole('textbox', { name: '编辑标签名' })).toBeFocused();
    await capture(page, app, 'edit', card);
    await card.getByRole('textbox', { name: '编辑标签名' }).fill('候选定稿');
    await tabTo(page, card.getByRole('button', { name: '紫色', exact: true }));
    await page.keyboard.press('Space');
    await tabTo(page, card.getByRole('button', { name: '保存', exact: true }));
    await page.keyboard.press('Enter');
    await expect(page.locator('.canvas-tag-badge')).toHaveText('候选定稿');
    await expect(page.locator('.canvas-tag-badge')).toHaveClass(/canvas-tag-purple/);
    await capture(page, app, 'card', card);
    await card.getByRole('textbox', { name: '标签名', exact: true }).fill('候选定稿');
    await card.getByRole('button', { name: '添加', exact: true }).click();
    await expect(card.getByRole('alert')).toHaveText('标签名已存在');
    await page.screenshot({
      path: join(screenshots, 'name-conflict-dark-720.png'),
      animations: 'disabled',
    });
    await page.keyboard.press('Escape');
    await expect(page.getByRole('region', { name: '画布编辑区' })).toBeFocused();
    await openPage(page, '第二创作页');
    await expect(page.locator('.canvas-tag-badge')).toHaveText('候选定稿');
    await expect(page.locator('.canvas-tag-badge')).toHaveClass(/canvas-tag-purple/);
    await openPage(page, '验收创作页');
    await openTags(page, firstId);
    card = page.getByRole('dialog', { name: '画布标签', exact: true });
    await tabTo(page, card.getByRole('button', { name: '删除标签 候选定稿', exact: true }));
    await page.keyboard.press('Enter');
    let dialog = page.getByRole('dialog', { name: '删除标签「候选定稿」', exact: true });
    await expect(dialog).toBeVisible();
    await expect
      .poll(() => dialog.evaluate((element) => element.contains(document.activeElement)))
      .toBe(true);
    await expect(dialog.getByRole('listitem')).toHaveCount(2);
    await expect(dialog.getByRole('img', { name: '已锁定' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: '删除标签', exact: true })).toBeDisabled();
    await capture(page, app, 'delete', dialog);
    await tabTo(page, dialog.getByRole('combobox', { name: '全部改为', exact: true }));
    await page.keyboard.press('Alt+ArrowDown');
    await page.keyboard.press('End');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('Enter');
    await expect(dialog.getByRole('combobox', { name: /的改派标签$/ }).first()).toHaveValue(
      'builtin-final',
    );
    await expect(dialog.getByRole('combobox', { name: /的改派标签$/ }).last()).toHaveValue(
      'builtin-final',
    );

    // 弹窗打开后另一页出现新引用，真实 engine 返回 409，宿主应刷新并要求重新选择。
    const latest = ProjectPageRecord.parse(await api(page, secondPath));
    const extra = {
      ...latest.document.nodes[0],
      id: 'late-reference',
      title: '稍后新增引用',
      position: { x: 430, y: 100 },
    };
    await api(page, secondPath, 'PUT', {
      revision: latest.revision,
      document: { ...latest.document, nodes: [...latest.document.nodes, extra] },
    });
    await tabTo(page, dialog.getByRole('button', { name: '删除标签', exact: true }));
    await page.keyboard.press('Enter');
    dialog = page.getByRole('dialog', { name: '删除标签「候选定稿」', exact: true });
    await expect(dialog.getByRole('alert')).toHaveText('标签引用已变化，请重新选择。');
    await expect(dialog.getByRole('listitem')).toHaveCount(1);
    await expect(dialog.getByRole('button', { name: '删除标签', exact: true })).toBeDisabled();
    await page.screenshot({
      path: join(screenshots, 'delete-conflict-dark-720.png'),
      animations: 'disabled',
    });
    await dialog
      .getByRole('combobox', { name: '全部改为', exact: true })
      .selectOption('builtin-final');
    await tabTo(page, dialog.getByRole('button', { name: '删除标签', exact: true }));
    await page.keyboard.press('Enter');
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('.canvas-tag-badge')).toHaveText('最终版');
    const tags = ProjectTag.array().parse(await api(page, `/projects/${target.projectId}/tags`));
    expect(tags.some((tag) => tag.name === '候选定稿')).toBe(false);
    for (const path of [target.pagePath, secondPath]) {
      const record = ProjectPageRecord.parse(await api(page, path));
      expect(record.document.nodes.every((node) => node.tagId === 'builtin-final')).toBe(true);
    }
    await page.keyboard.press('Escape');
    await app.close();
    app = undefined;
    app = await _electron.launch({ args: [desktop, `--user-data-dir=${userData}`] });
    page = await app.firstWindow();
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await openPage(page, '验收创作页');
    await expect(page.locator('.canvas-tag-badge')).toHaveText('最终版');
    await expect(page.locator('.canvas-tag-badge')).toHaveClass(/canvas-tag-green/);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(720, 560));
    const canvas = page.getByRole('region', { name: '画布编辑区' });
    await canvas.focus();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Shift+1');
    await capture(page, app, 'badge', canvas);
    await openPage(page, '第二创作页');
    await expect(page.locator('.canvas-tag-badge')).toHaveText(['最终版', '最终版']);
    const manifest = JSON.parse(
      await readFile(join(target.rootPath, '.frameloom/project.json'), 'utf8'),
    ) as { tags: ProjectTag[] };
    expect(manifest.tags).toEqual(tags);
    expect(pageErrors).toEqual([]);
  } finally {
    await app?.close();
    await rm(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
