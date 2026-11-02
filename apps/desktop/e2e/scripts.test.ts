import { test, expect, _electron, type Page } from '@playwright/test';
import { mkdir, mkdtemp, readFile, rm, rename, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import {
  ProjectSummary,
  EpisodeSummary,
  ScriptResult,
  StoryResult,
  ProjectDiskManifest,
  ProjectManifest,
  ProjectPageSummary,
  Model,
  getProtocol,
} from '@frame-loom/contracts';
import { engineApi, disposeTestApp, addMediaChannel } from './model-service.fixture';
import { scriptModel, shortSource, longSource } from './script-model.fixture';
const desktop = resolve(fileURLToPath(new URL('..', import.meta.url)));
const evidence = resolve(desktop, '../../.cache/standard-script-rebuild');
async function openEpisode(page: Page, name: string) {
  await page.getByRole('link', { name: '项目库', exact: true }).first().click();
  await page.getByRole('link', { name: `打开项目 ${name}` }).click();
  await page.getByText('第 1 集', { exact: true }).last().click();
  await expect(page.getByRole('toolbar', { name: '剧本操作' })).toBeVisible();
}
async function setup(long = false) {
  const sandbox = await mkdtemp(join(tmpdir(), 'loom-standard-e2e-'));
  await mkdir(evidence, { recursive: true });
  const model = await scriptModel(long);
  const userData = join(sandbox, 'user-data');
  const app = await _electron.launch({ args: [desktop, `--user-data-dir=${userData}`] });
  const page = await app.firstWindow();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (
      message.type() === 'error' &&
      /content security policy|violates.*directive/iu.test(message.text())
    )
      errors.push(message.text());
  });
  const channel = await addMediaChannel(page, model.origin, 'test');
  const chat = Model.array().parse(
    await engineApi(page, `/channels/${channel.id}/models`, 'POST', [
      {
        kind: 'chat',
        protocolId: 'openai-chat',
        upstreamModelId: 'script-mock',
        displayName: '剧本模拟',
        enabled: true,
        capability: {
          ...getProtocol('openai-chat')!.templates.chat!,
          maxOutput: 8192,
          contextWindow: 32768,
        },
      },
    ]),
  )[0];
  await engineApi(page, '/model-defaults', 'PUT', { chat: chat.id });
  const project = ProjectSummary.parse(
    await engineApi(page, '/projects', 'POST', {
      name: '标准剧本验收',
      location: sandbox,
      profile: { form: null, medium: null, genres: ['悬疑'], aspect: null, style: '冷色写实' },
    }),
  );
  const episode = EpisodeSummary.parse(
    await engineApi(page, `/projects/${project.id}/episodes`, 'POST', {
      number: 1,
      title: '陌生来客',
      duration_sec: 780,
    }),
  );
  const base = `/projects/${project.id}`,
    url = `${base}/episodes/${episode.id}/script`;
  await page.reload();
  await openEpisode(page, project.name);
  return {
    sandbox,
    userData,
    model,
    app,
    page,
    project,
    episode,
    base,
    url,
    errors,
    async close() {
      await disposeTestApp(app);
      await app.close().catch(() => {});
      await model.close();
      await rm(sandbox, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
    },
  };
}
async function importSource(page: Page, text: string, replace = false) {
  await page.getByRole('toolbar').getByRole('button', { name: '重新导入' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('剧本原文').fill(text);
  await dialog.getByRole('button', { name: '开始解析' }).click();
  if (replace) await dialog.getByRole('button', { name: '确认替换并解析' }).click();
  await expect.poll(() => dialog.allTextContents(), { timeout: 30000 }).toEqual([]);
}
test('F01 标准导入、编辑、保存、稳定身份及视觉', async () => {
  test.setTimeout(180000);
  const s = await setup();
  try {
    await importSource(s.page, shortSource);
    await expect
      .poll(async () => ScriptResult.parse(await engineApi(s.page, s.url)).conversion?.status)
      .toBe('succeeded');
    await expect(s.page.locator('[data-script-beat]')).toHaveCount(2);
    expect(await s.page.getByRole('toolbar').getByRole('button').allTextContents()).toEqual([
      '重新导入',
      '保存',
    ]);
    await expect(s.page.getByLabel('剧本编辑区')).toHaveAttribute('contenteditable', 'true');
    await s.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].focus());
    const before = ScriptResult.parse(await engineApi(s.page, s.url));
    const line = s.page.locator('[data-script-field="line"]');
    await line.click();
    await s.page.keyboard.press('End');
    await s.page.keyboard.insertText('请回答。');
    await expect(line).toContainText('请回答。');
    await s.page.keyboard.press('Control+s');
    await expect
      .poll(async () => ScriptResult.parse(await engineApi(s.page, s.url)).revision)
      .toBeGreaterThan(before.revision);
    const saved = ScriptResult.parse(await engineApi(s.page, s.url));
    expect(saved.document.scenes[0].beats[1]).toMatchObject({
      type: 'dialogue',
      line: '您认识我？请回答。',
    });
    expect(saved.document.scenes[0].beats[1].id).toBe(before.document.scenes[0].beats[1].id);
    for (const scheme of ['light', 'dark'] as const) {
      await s.page.emulateMedia({ colorScheme: scheme });
      await s.page.evaluate(
        async (value) =>
          (
            window as unknown as { frameLoom: { theme: { set(value: string): Promise<unknown> } } }
          ).frameLoom.theme.set(value),
        scheme,
      );
      await s.app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].setSize(1600, 900),
      );
      await s.page.locator('[data-script-scroll]').evaluate((element) => {
        element.scrollTop = 0;
      });
      await expect
        .poll(() =>
          s.page.evaluate(() => getComputedStyle(document.documentElement).colorScheme === 'dark'),
        )
        .toBe(scheme === 'dark');
      await s.page.screenshot({ path: join(evidence, `editor-${scheme}-1600.png`) });
      for (const width of [901, 899, 821, 819]) {
        const container = s.page.locator('.script-container');
        await container.evaluate((element, value) => {
          (element as HTMLElement).style.width = `${value}px`;
        }, width);
        await expect
          .poll(() => container.evaluate((element) => element.getBoundingClientRect().width))
          .toBe(width);
        await expect
          .poll(() =>
            s.page
              .locator('.script-layout')
              .evaluate((element) => getComputedStyle(element).flexDirection),
          )
          .toBe(width <= 820 ? 'column' : 'row');
        await expect
          .poll(() =>
            s.page
              .locator('.script-doc-title')
              .evaluate((element) => getComputedStyle(element).fontSize),
          )
          .toBe(width <= 900 ? '20px' : '25px');
        await s.page.locator('[data-script-scroll]').evaluate((element) => {
          element.scrollTop = 0;
        });
        await container.screenshot({
          path: join(evidence, `editor-${scheme}-container-${width}.png`),
        });
      }
      await s.page.locator('.script-container').evaluate((element) => {
        (element as HTMLElement).style.removeProperty('width');
      });
    }
    const sizes = await s.page.locator('.script-doc').evaluate((element) => ({
      maxWidth: getComputedStyle(element).maxWidth,
      padding: getComputedStyle(element).padding,
      fontSize: getComputedStyle(document.querySelector('.script-doc-title')!).fontSize,
      outline: getComputedStyle(document.querySelector('.script-outline')!).width,
      container: document.querySelector('.script-container')!.getBoundingClientRect().width,
      bodyFont: getComputedStyle(document.body).fontFamily,
      textFont: getComputedStyle(element).fontFamily,
    }));
    expect(sizes.maxWidth).toBe('720px');
    expect(sizes.outline).toBe('258px');
    expect(sizes.fontSize).toBe('25px');
    expect(sizes.padding).toBe('56px 40px 240px');
    await writeFile(join(evidence, 'editor-sizes.json'), JSON.stringify(sizes, null, 2));
    await s.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(720, 560));
    await s.page.locator('[data-script-scroll]').evaluate((element) => {
      element.scrollTop = 0;
    });
    await s.page.screenshot({ path: join(evidence, 'editor-dark-720.png') });
    await s.page.getByRole('button', { name: /场次大纲/ }).click();
    await expect(s.page.getByRole('button', { name: /1-1.*便利店/ })).toBeVisible();
    await s.page.getByRole('button', { name: /1-1.*便利店/ }).click();
    await expect(s.page.locator('.script-outline')).toHaveAttribute('data-expanded', 'false');
    expect(await s.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await s.page.reload();
    await expect(s.page.locator('[data-script-field="line"]')).toContainText('请回答。');
    const hook = s.page.locator('[data-script-field="hook_end"]');
    await hook.click();
    await s.page.keyboard.insertText('来客留下钥匙。');
    await expect(hook).toContainText('来客留下钥匙。');
    await s.page.getByRole('button', { name: '添加场次', exact: true }).last().click();
    await expect(s.page.locator('[data-script-scene]')).toHaveCount(2);
    await s.page
      .locator('[data-script-scene]')
      .last()
      .getByRole('button', { name: '上移场次' })
      .click();
    await s.page.keyboard.press('Control+s');
    await expect
      .poll(async () => ScriptResult.parse(await engineApi(s.page, s.url)).document.scenes.length)
      .toBe(2);
    const moved = ScriptResult.parse(await engineApi(s.page, s.url));
    expect(moved.document.scenes[1].id).toBe(before.document.scenes[0].id);
    expect(moved.document.scenes.map((scene) => scene.scene_id)).toEqual(['1-1', '1-2']);
    expect(moved.document.meta.hook_end).toBe('来客留下钥匙。');
    await s.page.reload();
    await expect(s.page.locator('[data-script-field="hook_end"]')).toContainText('来客留下钥匙。');
    await s.app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(1280, 800),
    );
    const emotion = s.page.locator('[data-script-field="emotion"]');
    await emotion.fill('');
    await emotion.click();
    await s.page.keyboard.insertText('稍作停顿');
    await expect(emotion).toContainText('稍作停顿');
    await emotion.fill('');
    const longLocation = '城市北侧老旧居民楼顶层的狭长走廊与没有灯光的楼梯转角';
    await s.page.locator('[data-script-field="location"]').last().fill(longLocation);
    await s.page
      .locator('[data-script-field="characters"]')
      .last()
      .fill('林夏、老陈、西装男、周屿、路人甲、路人乙、邻居、店长');
    await expect(s.page.locator('[data-script-field="location"]').last()).toContainText(
      longLocation,
    );
    await s.page.keyboard.press('Control+s');
    await expect
      .poll(
        async () => ScriptResult.parse(await engineApi(s.page, s.url)).document.scenes[1].location,
      )
      .toBe(longLocation);
    for (const scheme of ['light', 'dark'] as const) {
      await s.page.emulateMedia({ colorScheme: scheme });
      await s.page.evaluate(
        async (value) =>
          (
            window as unknown as { frameLoom: { theme: { set(value: string): Promise<unknown> } } }
          ).frameLoom.theme.set(value),
        scheme,
      );
      await expect
        .poll(() =>
          s.page.evaluate(() => getComputedStyle(document.documentElement).colorScheme === 'dark'),
        )
        .toBe(scheme === 'dark');
      await s.page.locator('[data-script-scroll]').evaluate((element) => {
        element.scrollTop = 370;
      });
      await s.page.screenshot({ path: join(evidence, `editor-${scheme}-1280-edge.png`) });
      const alignment = await s.page
        .locator('[data-script-beat="dialogue"]')
        .evaluate((element) => ({
          speaker: element.querySelector('[data-script-field="speaker"]')!.getBoundingClientRect()
            .top,
          line: element.querySelector('[data-script-field="line"]')!.getBoundingClientRect().top,
        }));
      expect(Math.abs(alignment.speaker - alignment.line)).toBeLessThan(6);
      await s.page.locator('[data-script-beat="dialogue"]').screenshot({
        path: join(evidence, `editor-${scheme}-empty-emotion.png`),
      });
      expect(await s.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    }
    expect(await s.page.locator('[data-script-field="emotion"]').textContent()).toBe('');
    await s.page.route('**/projects/*/episodes/*/script', async (route) => {
      if (route.request().method() === 'PUT')
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ code: 'TEST_SAVE_FAILURE', message: '模拟磁盘不可写' }),
        });
      else await route.continue();
    });
    await hook.fill('保存失败后仍然保留的新钩子。');
    await s.page.keyboard.press('Control+s');
    await expect(s.page.getByText('保存失败，草稿已保留', { exact: true })).toBeVisible();
    await s.page.screenshot({ path: join(evidence, 'editor-save-error.png') });
    expect(await hook.textContent()).toBe('保存失败后仍然保留的新钩子。');
    await s.page.unroute('**/projects/*/episodes/*/script');
    await s.page.getByRole('toolbar').getByRole('button', { name: '保存', exact: true }).click();
    await expect
      .poll(async () => ScriptResult.parse(await engineApi(s.page, s.url)).document.meta.hook_end)
      .toBe('保存失败后仍然保留的新钩子。');
    expect(s.errors).toEqual([]);
  } finally {
    await s.close();
  }
});
test('F02 长文分批失败保留、重试复用成功批次', async () => {
  test.setTimeout(180000);
  const s = await setup(true);
  try {
    await importSource(s.page, '## 便利店 夜 内\n△ 老陈站在门外。');
    await expect
      .poll(async () => ScriptResult.parse(await engineApi(s.page, s.url)).conversion?.status)
      .toBe('succeeded');
    const original = ScriptResult.parse(await engineApi(s.page, s.url));
    const originalStory = StoryResult.parse(await engineApi(s.page, `${s.base}/story`));
    s.model.setFail(true);
    await importSource(s.page, longSource, true);
    await expect
      .poll(async () => ScriptResult.parse(await engineApi(s.page, s.url)).conversion?.status)
      .toBe('failed');
    expect(ScriptResult.parse(await engineApi(s.page, s.url)).document).toEqual(original.document);
    expect(StoryResult.parse(await engineApi(s.page, `${s.base}/story`))).toEqual(originalStory);
    const before = s.model.requests.filter((r) => r.mode === 'locate').length;
    s.model.setFail(false);
    await s.page.getByRole('button', { name: '重试失败批次' }).click();
    await expect
      .poll(async () => ScriptResult.parse(await engineApi(s.page, s.url)).conversion?.status, {
        timeout: 60000,
      })
      .toBe('succeeded');
    const record = ScriptResult.parse(await engineApi(s.page, s.url));
    expect(record.document.scenes[0].beats).toHaveLength(160);
    expect(s.model.requests.filter((r) => r.mode === 'locate')).toHaveLength(before);
    expect(s.model.requests.filter((r) => r.mode === 'scene').length).toBeGreaterThanOrEqual(3);
    const release = s.model.pause();
    await importSource(s.page, '## 便利店 夜 内\n△ 老陈站在门外。\n△ 老陈站在门外。', true);
    await expect(s.page.getByRole('button', { name: '取消解析' })).toBeVisible();
    await s.page.getByRole('button', { name: '取消解析' }).click();
    await expect
      .poll(async () => ScriptResult.parse(await engineApi(s.page, s.url)).conversion?.status)
      .toBe('cancelled');
    release();
    expect(ScriptResult.parse(await engineApi(s.page, s.url)).document).toEqual(record.document);
    expect(s.errors).toEqual([]);
  } finally {
    await s.close();
  }
});
test('F03 设定资料、别名、出现位置与四类管理', async () => {
  test.setTimeout(120000);
  const s = await setup();
  try {
    await importSource(s.page, shortSource);
    await expect
      .poll(async () => ScriptResult.parse(await engineApi(s.page, s.url)).conversion?.status)
      .toBe('succeeded');
    const story = StoryResult.parse(await engineApi(s.page, `${s.base}/story`));
    const person = story.elements.find((e) => e.name === '林夏')!;
    await engineApi(s.page, `${s.base}/story/elements/${person.id}`, 'PATCH', {
      name: '林晚',
      attrs: {
        age: '约30岁',
        gender: '女',
        appearance: ['黑发'],
        personality: ['谨慎'],
        signatureActions: ['转笔'],
        signatureProps: ['旧钥匙'],
      },
    });
    for (const [kind, name] of [
      ['prop', '旧钥匙'],
      ['costume', '风衣'],
    ])
      await engineApi(s.page, `${s.base}/story/elements`, 'POST', { kind, name });
    const result = StoryResult.parse(await engineApi(s.page, `${s.base}/story`));
    expect(result.elements.find((e) => e.id === person.id)?.aliases).toEqual(['林夏']);
    expect(new Set(result.elements.map((e) => e.kind)).size).toBe(4);
    const second = EpisodeSummary.parse(
      await engineApi(s.page, `${s.base}/episodes`, 'POST', { number: 2, title: '同名复用' }),
    );
    const secondScript = `${s.base}/episodes/${second.id}/script`;
    await engineApi(s.page, `${secondScript}/import`, 'POST', { revision: 1, text: shortSource });
    await expect
      .poll(
        async () => ScriptResult.parse(await engineApi(s.page, secondScript)).conversion?.status,
      )
      .toBe('succeeded');
    const linked = StoryResult.parse(await engineApi(s.page, `${s.base}/story`));
    expect(linked.elements).toHaveLength(5);
    expect(linked.elements.find((element) => element.id === person.id)?.episodes).toHaveLength(2);
    expect(
      ScriptResult.parse(await engineApi(s.page, s.url)).document.scenes[0].beats[1],
    ).toMatchObject({ speaker: '林夏' });
    await s.page.getByRole('navigation', { name: '面包屑' }).getByRole('link').nth(1).click();
    await s.page.getByRole('tab', { name: '设定库' }).click();
    await s.page.getByText('林晚', { exact: true }).click();
    await expect(s.page.getByLabel('年龄', { exact: true })).toHaveValue('约30岁');
    await expect(s.page.getByLabel('标志道具（每行一项）')).toHaveValue('旧钥匙');
    const age = s.page.getByLabel('年龄', { exact: true });
    await age.fill('约31岁');
    await age.press('Tab');
    await expect
      .poll(
        async () =>
          StoryResult.parse(await engineApi(s.page, `${s.base}/story`)).elements.find(
            (element) => element.id === person.id,
          )?.attrs,
      )
      .toMatchObject({ age: '约31岁' });
  } finally {
    await s.close();
  }
});
test('F04 项目关库移动、重新定位与重开稳定身份', async () => {
  test.setTimeout(120000);
  const s = await setup();
  try {
    const pageFile = ProjectPageSummary.parse(
      await engineApi(s.page, `${s.base}/pages`, 'POST', {
        name: '保留画布',
        episodeId: s.episode.id,
      }),
    );
    const legacy = ProjectManifest.parse(await engineApi(s.page, s.base));
    await s.app.close();
    const kept = [
      `.frameloom/pages/${pageFile.id}.json`,
      '资产/哨兵.txt',
      '.frameloom/tmp/unknown.txt',
    ];
    for (const path of kept.slice(1)) {
      await mkdir(join(s.project.rootPath, path, '..'), { recursive: true });
      await writeFile(join(s.project.rootPath, path), '不能清除的哨兵');
    }
    const hashes = await Promise.all(
      kept.map(async (path) =>
        createHash('sha256')
          .update(await readFile(join(s.project.rootPath, path)))
          .digest('hex'),
      ),
    );
    for (const path of ['scripts/invalid.json', 'story.json', 'trash/scripts/invalid.json']) {
      await mkdir(join(s.project.rootPath, '.frameloom', path, '..'), { recursive: true });
      await writeFile(join(s.project.rootPath, '.frameloom', path), '旧域损坏内容也应清除');
    }
    await writeFile(
      join(s.project.rootPath, '.frameloom/project.json'),
      JSON.stringify({ ...legacy, formatVersion: 1 }),
    );
    await rm(join(s.project.rootPath, '.frameloom/project.sqlite'));
    const upgrading = await _electron.launch({ args: [desktop, `--user-data-dir=${s.userData}`] });
    let before: ScriptResult;
    let scriptUrl: string;
    try {
      const window = await upgrading.firstWindow();
      const upgraded = ProjectManifest.parse(await engineApi(window, s.base));
      expect(upgraded.episodes).toEqual([]);
      expect(upgraded.pages[0].episodeId).toBeNull();
      expect(
        await Promise.all(
          kept.map(async (path) =>
            createHash('sha256')
              .update(await readFile(join(s.project.rootPath, path)))
              .digest('hex'),
          ),
        ),
      ).toEqual(hashes);
      for (const path of ['scripts/invalid.json', 'story.json', 'trash/scripts/invalid.json'])
        await expect(readFile(join(s.project.rootPath, '.frameloom', path))).rejects.toMatchObject({
          code: 'ENOENT',
        });
      const episode = EpisodeSummary.parse(
        await engineApi(window, `${s.base}/episodes`, 'POST', {
          number: 1,
          title: '升级后新集',
          duration_sec: 600,
        }),
      );
      scriptUrl = `${s.base}/episodes/${episode.id}/script`;
      await engineApi(window, `${scriptUrl}/import`, 'POST', { revision: 1, text: shortSource });
      await expect
        .poll(async () => ScriptResult.parse(await engineApi(window, scriptUrl)).conversion?.status)
        .toBe('succeeded');
      before = ScriptResult.parse(await engineApi(window, scriptUrl));
    } finally {
      await upgrading.close();
    }
    const moved = join(s.sandbox, '移动后的项目');
    await rename(s.project.rootPath, moved);
    const reopened = await _electron.launch({ args: [desktop, `--user-data-dir=${s.userData}`] });
    try {
      const page = await reopened.firstWindow();
      await engineApi(page, `${s.base}/relocate`, 'POST', { rootPath: moved });
      const after = ScriptResult.parse(await engineApi(page, scriptUrl));
      expect(after.document).toEqual(before.document);
      await engineApi(page, scriptUrl, 'PUT', {
        revision: after.revision,
        document: after.document,
      });
    } finally {
      await reopened.close();
    }
    const manifest = ProjectDiskManifest.parse(
      JSON.parse(await readFile(join(moved, '.frameloom/project.json'), 'utf8')),
    );
    expect(manifest.formatVersion).toBe(2);
    expect(manifest.episodes).toBeUndefined();
  } finally {
    await s.close();
  }
});
