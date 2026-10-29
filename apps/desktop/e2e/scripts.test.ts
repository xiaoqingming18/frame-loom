import { test, expect, _electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createServer, type Server } from 'node:http';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ScriptResult, StoryResult, parseScriptText } from '@frame-loom/contracts';
import { engineApi, disposeTestApp, addMediaChannel, addMediaModel } from './model-service.fixture';

const desktop = resolve(fileURLToPath(new URL('..', import.meta.url)));
const screenshots = resolve(desktop, '../../.cache/scripts');
const sample = await readFile(
  resolve(desktop, '../../packages/contracts/fixtures/script-sample-01.txt'),
  'utf8',
);
async function theme(page: Page, value: 'light' | 'dark') {
  await page.evaluate(
    (value) =>
      (
        window as unknown as { frameLoom: { theme: { set(value: string): Promise<unknown> } } }
      ).frameLoom.theme.set(value),
    value,
  );
  await expect
    .poll(() => page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches))
    .toBe(value === 'dark');
}
async function shot(page: Page, name: string) {
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
  await page.screenshot({ path: join(screenshots, `${name}.png`), animations: 'disabled' });
}
function errors(page: Page) {
  const result: string[] = [];
  page.on('pageerror', (error) => result.push(error.message));
  page.on('console', (message) => {
    if (
      /content security policy|violates.*directive/iu.test(message.text()) &&
      message.type() === 'error'
    )
      result.push(message.text());
  });
  return result;
}

test('剧本创建导入编辑设定库与重启保留', async () => {
  test.setTimeout(180000);
  await mkdir(screenshots, { recursive: true });
  const sandbox = await mkdtemp(join(tmpdir(), 'frame-scripts-'));
  const userData = join(sandbox, 'user-data');
  const location = join(sandbox, 'projects');
  await mkdir(location);
  let app: ElectronApplication | undefined;
  try {
    app = await _electron.launch({ args: [desktop, `--user-data-dir=${userData}`] });
    let page = await app.firstWindow();
    await page.emulateMedia({ colorScheme: null });
    const pageErrors = errors(page);
    await page.getByRole('link', { name: '项目库', exact: true }).click();
    await app.evaluate(({ dialog }, location) => {
      dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [location] });
    }, location);
    await page.getByRole('button', { name: '新建项目', exact: true }).last().click();
    let dialog = page.getByRole('dialog');
    await dialog.getByLabel('项目名称', { exact: true }).fill('剧本验收');
    await dialog.getByRole('button', { name: '更改' }).click();
    await dialog.getByText('项目设定（可选）', { exact: true }).click();
    for (const value of ['light', 'dark'] as const) {
      await theme(page, value);
      await shot(page, `new-project-${value}`);
    }
    await dialog.getByText('项目设定（可选）', { exact: true }).click();
    await dialog.getByRole('button', { name: '创建项目' }).click();
    await page.getByRole('button', { name: '新建剧集', exact: true }).click();
    dialog = page.getByRole('dialog');
    await expect(dialog.getByLabel('集号')).toHaveValue('1');
    await dialog.getByLabel('标题').fill('重逢');
    await dialog.getByRole('button', { name: '确认', exact: true }).click();
    await page.getByRole('button', { name: '粘贴整集剧本' }).click();
    dialog = page.getByRole('dialog');
    await dialog.getByLabel('剧本原文').fill(sample);
    await expect(dialog.getByText('首次导入前，请补齐内容形式、制作媒介和题材。')).toBeVisible();
    await dialog.getByRole('radio', { name: '短剧', exact: true }).check();
    await dialog.getByRole('radio', { name: '真人实拍', exact: true }).check();
    await dialog.getByRole('button', { name: '悬疑', exact: true }).click();
    await dialog.getByRole('button', { name: '开始转换' }).click();
    await expect(
      page.getByText('已识别 7 场、60 段，新增 10 个待确认元素', { exact: true }),
    ).toBeVisible();
    await expect(page.locator('.tiptap p[data-id]')).toHaveCount(60);
    const projects = (await engineApi(page, '/projects')) as { id: string }[];
    const projectId = projects[0].id;
    const episodes = (await engineApi(page, `/projects/${projectId}/episodes`)) as { id: string }[];
    const episodeId = episodes[0].id;
    const base = `/projects/${projectId}/episodes/${episodeId}/script`;
    const unsure = page.locator('.tiptap p').filter({ hasText: '周屿 你这几年还好吗' });
    await unsure.getByRole('button', { name: '存疑' }).click();
    await page.getByRole('button', { name: '改为对白（角色：周屿）' }).click();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].focus());
    await page
      .locator('.tiptap p')
      .last()
      .evaluate((node) => {
        (node.parentElement as HTMLElement).focus();
        const range = document.createRange();
        range.selectNodeContents(node);
        range.collapse(false);
        const selection = window.getSelection()!;
        selection.removeAllRanges();
        selection.addRange(range);
        document.dispatchEvent(new Event('selectionchange'));
      });
    await expect(page.getByLabel('段落类型', { exact: true })).toHaveValue('transition');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Control+2');
    await page.keyboard.type('1-8 夜 外 天台');
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-script-outline]').getByText('1-8 天台')).toBeAttached();
    const little = page.locator('.tiptap p').filter({ hasText: '小林啊，别想了，睡吧。' });
    await little.scrollIntoViewIfNeeded();
    await little.evaluate((node) => {
      const range = document.createRange();
      range.setStart(node.firstChild!, 0);
      range.setEnd(node.firstChild!, 2);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
    });
    await page.getByRole('button', { name: '标记为人物' }).click();
    await page.getByRole('button', { name: '元素栏', exact: true }).click();
    const panel = page.getByRole('complementary', { name: '本集元素' });
    const row = panel
      .locator('div.rounded-md.border')
      .filter({ has: page.getByRole('button', { name: /^小林/u }) });
    await row.getByRole('button', { name: '合并到…' }).click();
    const story = StoryResult.parse(await engineApi(page, `/projects/${projectId}/story`));
    const summer = story.elements.find((element) => element.name === '林夏')!;
    await panel.getByLabel('合并目标').selectOption(summer.id);
    await expect(row).toHaveCount(0);
    await page.getByRole('link', { name: '在设定库中管理' }).click();
    await expect(page.getByRole('heading', { name: '小林', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '人物 4' })).toBeVisible();
    await page.getByRole('heading', { name: '林夏', exact: true }).click();
    await expect(page.getByRole('button', { name: '删除别名 小林' })).toBeVisible();
    for (const value of ['light', 'dark'] as const) {
      await theme(page, value);
      await shot(page, `story-${value}`);
    }
    await page.getByRole('dialog').getByRole('link').first().click();
    await expect(page.getByRole('textbox', { name: '剧本编辑区' })).toBeVisible();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1600, 900));
    await page
      .locator('.tiptap p')
      .filter({ hasText: '小林啊，别想了，睡吧。' })
      .scrollIntoViewIfNeeded();
    for (const value of ['light', 'dark'] as const) {
      await theme(page, value);
      await shot(page, `editor-${value}`);
    }
    await page.getByRole('button', { name: '大纲', exact: true }).click();
    await expect(page.getByRole('navigation', { name: '场次大纲' })).toBeHidden();
    await page.getByRole('button', { name: '大纲', exact: true }).click();
    await expect(page.getByRole('navigation', { name: '场次大纲' })).toBeVisible();
    await page.getByRole('button', { name: '元素栏', exact: true }).click();
    await expect(page.getByRole('complementary', { name: '本集元素' })).toBeHidden();
    await page.getByRole('button', { name: '元素栏', exact: true }).click();
    await expect(page.getByRole('complementary', { name: '本集元素' })).toBeVisible();
    await expect
      .poll(async () =>
        ScriptResult.parse(await engineApi(page, base)).document.blocks.some(
          (block) =>
            block.text === '天台' &&
            block.attrs &&
            'time' in block.attrs &&
            block.attrs.time === 'night',
        ),
      )
      .toBe(true);
    await page.getByRole('navigation', { name: '面包屑' }).getByRole('link').nth(1).click();
    for (const value of ['light', 'dark'] as const) {
      await theme(page, value);
      await shot(page, `episodes-${value}`);
    }
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(720, 560));
    await shot(page, 'episodes-720');
    await page.getByText('重逢', { exact: true }).last().click();
    await expect(page.getByRole('textbox', { name: '剧本编辑区' })).toBeVisible();
    await expect(page.getByRole('button', { name: '更多', exact: true })).toBeVisible();
    await shot(page, 'editor-720');
    expect(pageErrors).toEqual([]);
    const before = ScriptResult.parse(await engineApi(page, base)).document;
    await app.close();
    app = await _electron.launch({ args: [desktop, `--user-data-dir=${userData}`] });
    page = await app.firstWindow();
    await page.emulateMedia({ colorScheme: null });
    const restartedErrors = errors(page);
    await page.getByRole('link', { name: '项目库', exact: true }).click();
    await page.getByRole('link', { name: '打开项目 剧本验收' }).click();
    await page.getByText('重逢', { exact: true }).last().click();
    await expect(page.getByRole('textbox', { name: '剧本编辑区' })).toBeVisible();
    expect(ScriptResult.parse(await engineApi(page, base)).document).toEqual(before);
    expect(
      StoryResult.parse(await engineApi(page, `/projects/${projectId}/story`)).elements.find(
        (element) => element.name === '林夏',
      )!.aliases,
    ).toContain('小林');
    expect(restartedErrors).toEqual([]);
  } finally {
    await disposeTestApp(app);
    await app?.close().catch(() => {});
    await rm(sandbox, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
  }
});

test('编辑器生产 CSP 输入法组字拖动与性能', async () => {
  test.setTimeout(180000);
  await mkdir(screenshots, { recursive: true });
  const sandbox = await mkdtemp(join(tmpdir(), 'frame-script-ime-'));
  let app: ElectronApplication | undefined;
  let server: Server | undefined;
  try {
    app = await _electron.launch({ args: [desktop, `--user-data-dir=${join(sandbox, 'data')}`] });
    const page = await app.firstWindow();
    await page.emulateMedia({ colorScheme: null });
    const pageErrors = errors(page);
    await page.getByRole('link', { name: '项目库', exact: true }).click();
    const project = (await engineApi(page, '/projects', 'POST', {
      name: '输入验收',
      location: sandbox,
    })) as { id: string };
    const episode = (await engineApi(page, `/projects/${project.id}/episodes`, 'POST', {
      number: 1,
      title: '',
    })) as { id: string };
    const base = `/projects/${project.id}/episodes/${episode.id}/script`;
    const record = ScriptResult.parse(await engineApi(page, base));
    await engineApi(page, base, 'PUT', {
      revision: record.revision,
      document: {
        schemaVersion: 1,
        blocks: [
          { id: 'a', type: 'action', text: '第一段' },
          { id: 'b', type: 'action', text: '第二段' },
          { id: 'c', type: 'action', text: '第三段' },
        ],
      },
    });
    await page.reload();
    await page.getByRole('link', { name: '打开项目 输入验收' }).click();
    await page.getByText('第 1 集', { exact: true }).last().click();
    const editor = page.getByRole('textbox', { name: '剧本编辑区' });
    await expect(editor).toBeVisible();
    await page.locator('[data-id="a"]').click();
    await page.keyboard.press('End');
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.imeSetComposition', { text: '你好', selectionStart: 2, selectionEnd: 2 });
    await cdp.send('Input.insertText', { text: '你好' });
    await expect(page.locator('[data-id="a"]')).toContainText('你好');
    await expect(page.locator('.tiptap p')).toHaveCount(3);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].focus());
    await page.locator('[data-id="a"]').hover();
    const handle = page.getByRole('button', { name: '段落类型：动作' });
    await expect(handle).toBeVisible();
    const source = await handle.boundingBox();
    const target = await page.locator('[data-id="c"]').boundingBox();
    if (!source || !target) throw new Error('拖放目标不可见');
    await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
    await page.mouse.down();
    await page.mouse.move(target.x + 50, target.y + target.height - 1, { steps: 20 });
    await page.mouse.up();
    await expect
      .poll(() =>
        page
          .locator('.tiptap p')
          .evaluateAll((nodes) => nodes.map((node) => (node as HTMLElement).dataset.id)),
      )
      .not.toEqual(['a', 'b', 'c']);
    await page.getByRole('navigation', { name: '面包屑' }).getByRole('link').nth(1).click();
    const parsed = parseScriptText(sample).blocks;
    const blocks = Array.from({ length: 3000 }, (_, index) => ({
      ...parsed[index % parsed.length],
      id: `perf-${index}`,
    }));
    const current = ScriptResult.parse(await engineApi(page, base));
    await engineApi(page, base, 'PUT', {
      revision: current.revision,
      document: { schemaVersion: 1, blocks },
    });
    const start = Date.now();
    await page.getByText('第 1 集', { exact: true }).last().click();
    await expect(editor).toBeVisible();
    await expect(page.locator('.tiptap p[data-id]')).toHaveCount(3000);
    const loadMs = Date.now() - start;
    await editor.click();
    await page.keyboard.press('Control+Home');
    await editor.evaluate((element) => {
      let start = 0;
      const timings: number[] = [];
      (window as unknown as { scriptInputTimings: number[] }).scriptInputTimings = timings;
      element.addEventListener(
        'beforeinput',
        () => {
          start = performance.now();
        },
        true,
      );
      element.addEventListener('input', () =>
        queueMicrotask(() => timings.push(performance.now() - start)),
      );
    });
    const timings: number[] = [];
    for (let index = 0; index < 50; index++) {
      const start = performance.now();
      await page.keyboard.insertText('字');
      timings.push(performance.now() - start);
    }
    await writeFile(
      join(screenshots, 'performance.json'),
      JSON.stringify({
        blocks: 3000,
        loadMs,
        keyAverageMs: timings.reduce((a, b) => a + b, 0) / timings.length,
        inputProcessingAverageMs: await page.evaluate(() => {
          const values = (window as unknown as { scriptInputTimings: number[] }).scriptInputTimings;
          return values.reduce((a, b) => a + b, 0) / values.length;
        }),
      }),
    );
    expect(pageErrors).toEqual([]);
    server = createServer((_request, response) => {
      response.on('error', () => {});
    });
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('模拟服务端口不可用');
    const channel = await addMediaChannel(page, `http://127.0.0.1:${address.port}`, 'local-test');
    const model = await addMediaModel(page, channel.id, 'openai-chat', 'script-mock');
    await engineApi(page, '/model-defaults', 'PUT', {
      chat: model.id,
      image: null,
      video: null,
      tts: null,
    });
    await page.getByRole('button', { name: '重新导入', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('剧本原文').fill(sample);
    await dialog.getByRole('radio', { name: '短剧', exact: true }).check();
    await dialog.getByRole('radio', { name: '真人实拍', exact: true }).check();
    await dialog.getByRole('button', { name: '悬疑', exact: true }).click();
    await dialog.getByRole('button', { name: '开始转换' }).click();
    await dialog.getByRole('button', { name: '确认替换并转换' }).click();
    await expect(page.getByText(/识别段落类型 · 已处理/u)).toBeVisible();
    for (const value of ['light', 'dark'] as const) {
      await theme(page, value);
      await shot(page, `conversion-${value}`);
    }
    await page.getByRole('button', { name: '取消转换' }).click();
    await expect(page.getByRole('button', { name: '继续转换' })).toBeVisible();
  } finally {
    server?.closeAllConnections();
    server?.close();
    await disposeTestApp(app);
    await app?.close().catch(() => {});
    await rm(sandbox, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
  }
});
