import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect, type Browser } from '@playwright/test';
import {
  EpisodeSummary,
  ProjectSummary,
  ScriptResult,
  Model,
  getProtocol,
} from '@frame-loom/contracts';
import { addMediaChannel, engineApi } from './model-service.fixture';
import { scriptModel, shortSource } from './script-model.fixture';

const desktop = resolve(fileURLToPath(new URL('..', import.meta.url)));
const executable =
  process.env.FRAME_LOOM_PACKAGED_EXE ?? join(desktop, 'release/win-unpacked/Frame Loom.exe');
const evidence = resolve(desktop, '../../.cache/standard-script-rebuild');
const sandbox = await mkdtemp(join(tmpdir(), 'loom-packaged-script-'));
const userData = join(sandbox, 'user-data');
const model = await scriptModel();
const errors: string[] = [];
const requests: unknown[] = [];

async function launch() {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('无法分配临时调试端口');
  const port = address.port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  const child = spawn(
    executable,
    [
      `--user-data-dir=${userData}`,
      `--remote-debugging-port=${port}`,
      '--remote-debugging-address=127.0.0.1',
    ],
    {
      cwd: desktop,
      windowsHide: true,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined, NODE_OPTIONS: undefined },
      stdio: ['ignore', 'ignore', 'pipe'],
    },
  );
  let launchError: Error | undefined;
  let stderr = '';
  child.on('error', (error) => {
    launchError = error;
  });
  child.stderr.on('data', (chunk: Buffer) => {
    stderr = (stderr + chunk.toString()).slice(-16000);
  });
  let browser: Browser | undefined;
  try {
    const endpoint = `http://127.0.0.1:${port}`;
    await expect
      .poll(
        async () => {
          if (launchError) throw launchError;
          if (child.exitCode !== null)
            throw new Error(`目录版提前退出：${child.exitCode} ${stderr}`);
          return fetch(`${endpoint}/json/version`, { signal: AbortSignal.timeout(500) })
            .then((response) => response.ok)
            .catch(() => false);
        },
        { timeout: 30000, intervals: [100, 200, 500] },
      )
      .toBe(true);
    browser = await chromium.connectOverCDP(endpoint);
    const context = browser.contexts()[0];
    const page = context.pages()[0] ?? (await context.waitForEvent('page'));
    page.on('request', (request) => {
      if (request.url().startsWith('http://127.0.0.1:'))
        requests.push({ at: Date.now(), event: 'request', path: new URL(request.url()).pathname });
    });
    page.on('response', (response) => {
      if (response.url().startsWith('http://127.0.0.1:'))
        requests.push({
          at: Date.now(),
          event: 'response',
          path: new URL(response.url()).pathname,
          status: response.status(),
        });
    });
    page.on('requestfailed', (request) => {
      if (request.url().startsWith('http://127.0.0.1:'))
        requests.push({
          at: Date.now(),
          event: 'failed',
          path: new URL(request.url()).pathname,
          error: request.failure()?.errorText,
        });
    });
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (
        message.type() === 'error' &&
        /content security policy|violates.*directive/iu.test(message.text())
      )
        errors.push(message.text());
    });
    await expect(page.getByRole('link', { name: '项目库', exact: true }).first()).toBeVisible();
    await engineApi(page, '/health');
    return {
      page,
      async close() {
        try {
          if (child.exitCode === null) {
            await page
              .evaluate(() =>
                (
                  window as unknown as {
                    frameLoom: { window: { command(value: string): Promise<void> } };
                  }
                ).frameLoom.window.command('close'),
              )
              .catch((error: unknown) => {
                if (!(error instanceof Error) || !/closed/iu.test(error.message)) throw error;
              });
            await expect.poll(() => child.exitCode, { timeout: 15000 }).toBe(0);
          }
        } finally {
          if (child.exitCode === null) child.kill();
          await browser?.close();
        }
      },
    };
  } catch (error) {
    if (child.exitCode === null) child.kill();
    await browser?.close();
    throw error;
  }
}

async function openEpisode(page: Awaited<ReturnType<typeof launch>>['page'], name: string) {
  await page.getByRole('link', { name: '项目库', exact: true }).first().click();
  await page.getByRole('link', { name: `打开项目 ${name}` }).click();
  await page.getByText('第 1 集', { exact: true }).last().click();
  await expect(page.getByRole('toolbar', { name: '剧本操作' })).toBeVisible();
}

let current: Awaited<ReturnType<typeof launch>> | undefined;
try {
  await mkdir(evidence, { recursive: true });
  await rm(join(evidence, 'packaged-acceptance.json'), { force: true });
  await stat(executable);
  current = await launch();
  let page = current.page;
  const channel = await addMediaChannel(page, model.origin, 'test');
  const chat = Model.array().parse(
    await engineApi(page, `/channels/${channel.id}/models`, 'POST', [
      {
        kind: 'chat',
        protocolId: 'openai-chat',
        upstreamModelId: 'script-mock',
        displayName: '目录版模拟模型',
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
    await engineApi(page, '/projects', 'POST', { name: '目录版临时验收', location: sandbox }),
  );
  const episode = EpisodeSummary.parse(
    await engineApi(page, `/projects/${project.id}/episodes`, 'POST', {
      number: 1,
      title: '重新定位',
    }),
  );
  const base = `/projects/${project.id}`;
  const url = `${base}/episodes/${episode.id}/script`;
  await page.reload();
  await openEpisode(page, project.name);
  await page.getByRole('toolbar').getByRole('button', { name: '重新导入' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('剧本原文').fill(shortSource);
  await dialog.getByRole('button', { name: '开始解析' }).click();
  await expect.poll(() => dialog.allTextContents(), { timeout: 30000 }).toEqual([]);
  await expect
    .poll(async () => ScriptResult.parse(await engineApi(page, url)).conversion?.status, {
      timeout: 30000,
    })
    .toBe('succeeded');
  const line = page.locator('[data-script-field="line"]');
  await line.click();
  await page.keyboard.press('End');
  await page.keyboard.insertText('目录版已保存。');
  await expect(line).toContainText('目录版已保存。');
  await page.keyboard.press('Control+s');
  await expect
    .poll(async () => JSON.stringify(ScriptResult.parse(await engineApi(page, url)).document))
    .toContain('目录版已保存。');
  const before = ScriptResult.parse(await engineApi(page, url));
  await page.screenshot({ path: join(evidence, 'packaged-before-move.png') });
  await current.close();
  current = undefined;
  const moved = join(sandbox, '移动后的目录版项目');
  await rename(project.rootPath, moved);
  current = await launch();
  page = current.page;
  await engineApi(page, `${base}/relocate`, 'POST', { rootPath: moved });
  await page.reload();
  await openEpisode(page, project.name);
  await expect(page.locator('[data-script-field="line"]')).toContainText('目录版已保存。');
  const reopened = ScriptResult.parse(await engineApi(page, url));
  expect(reopened.document).toEqual(before.document);
  const hook = page.locator('[data-script-field="hook_end"]');
  await hook.click();
  await page.keyboard.insertText('移动后继续写入。');
  await expect(hook).toContainText('移动后继续写入。');
  await page.keyboard.press('Control+s');
  await expect
    .poll(async () => ScriptResult.parse(await engineApi(page, url)).document.meta.hook_end)
    .toBe('移动后继续写入。');
  const after = ScriptResult.parse(await engineApi(page, url));
  expect(after.revision).toBeGreaterThan(before.revision);
  expect(errors).toEqual([]);
  await page.screenshot({ path: join(evidence, 'packaged-after-move.png') });
  await current.close();
  current = undefined;
  await rename(moved, join(sandbox, '再次移动确认句柄释放'));
  await writeFile(
    join(evidence, 'packaged-acceptance.json'),
    JSON.stringify(
      {
        status: 'passed',
        at: new Date().toISOString(),
        executable,
        model: 'local-mock',
        calls: model.requests.length,
        beforeRevision: before.revision,
        afterRevision: after.revision,
        stableSceneId: after.document.scenes[0].id,
        errors,
      },
      null,
      2,
    ),
  );
  console.info('N02 通过：加固目录版导入、保存、正常退出、移动、重定位与再次保存。');
} catch (error) {
  await writeFile(
    join(evidence, 'packaged-failure.json'),
    JSON.stringify(
      {
        at: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error),
        modelCalls: model.requests.length,
        requests,
      },
      null,
      2,
    ),
  );
  throw error;
} finally {
  try {
    await current?.close();
  } finally {
    await model.close();
    await rm(sandbox, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
  }
}
