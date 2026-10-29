import { expect, test, _electron, chromium, type Page } from '@playwright/test';
import { createServer } from 'vite';
import { RendererConfigFactory, resolveConfig } from 'electron-vite';
import { createServer as createHttpServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CanvasMediaData, CanvasRecord, GenerationJob } from '@frame-loom/contracts';
import { addMediaChannel, addMediaModel, disposeTestApp, engineApi } from './model-service.fixture';

const desktop = resolve(fileURLToPath(new URL('..', import.meta.url)));

async function theme(page: Page, value: 'light' | 'dark') {
  await page.emulateMedia({ colorScheme: null });
  await page.evaluate(
    (value) =>
      (
        window as unknown as {
          frameLoom: { theme: { set(value: string): Promise<unknown> } };
        }
      ).frameLoom.theme.set(value),
    value,
  );
  await expect
    .poll(() => page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches))
    .toBe(value === 'dark');
  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.documentElement).colorScheme))
    .toBe(value);
}

test('全景模拟生成、比例诊断、真实纹理与当前／四向截图', async () => {
  test.setTimeout(180_000);
  const packaged = process.env.FRAME_LOOM_E2E_PANORAMA_PACKAGE === '1';
  const userData = await mkdtemp(join(tmpdir(), 'loom-panorama-'));
  let panorama = Buffer.alloc(0);
  const square = await readFile(new URL('./fixtures/reference-256.png', import.meta.url));
  const requests: string[] = [];
  const upstream = createHttpServer((request, response) => {
    if (
      request.method !== 'POST' ||
      request.url !== '/v1/images/edits' ||
      request.headers.authorization !== 'Bearer fixture-local'
    ) {
      response.writeHead(404).end();
      return;
    }
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      requests.push(Buffer.concat(chunks).toString());
      response.setHeader('Content-Type', 'application/json');
      response.end(
        JSON.stringify({
          data: [{ b64_json: (requests.length === 1 ? panorama : square).toString('base64') }],
        }),
      );
    });
  });
  await new Promise<void>((done) => upstream.listen(0, '127.0.0.1', done));
  let app: Awaited<ReturnType<typeof _electron.launch>> | undefined;
  let browser: Awaited<ReturnType<typeof chromium.connectOverCDP>> | undefined;
  let child: ReturnType<typeof spawn> | undefined;
  let vite: Awaited<ReturnType<typeof createServer>> | undefined;
  try {
    let page: Page;
    if (packaged) {
      child = spawn(
        join(desktop, 'release/win-unpacked/Frame Loom.exe'),
        ['--remote-debugging-port=0', `--user-data-dir=${userData}`],
        { windowsHide: true, stdio: 'ignore' },
      );
      let port = '';
      await expect
        .poll(async () => {
          try {
            port = (await readFile(join(userData, 'DevToolsActivePort'), 'utf8')).split('\n')[0];
            return !!port;
          } catch {
            return false;
          }
        })
        .toBe(true);
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
      const context = browser.contexts()[0];
      page = context.pages()[0] ?? (await context.waitForEvent('page'));
    } else {
      const { config } = await resolveConfig({ root: desktop }, 'serve');
      const renderer = await new RendererConfigFactory(
        config!.renderer!,
        {},
        { root: desktop },
      ).build();
      vite = await createServer({
        ...renderer,
        configFile: false,
        server: { ...renderer.server, port: 0 },
      });
      await vite.listen();
      app = await _electron.launch({ args: [desktop, `--user-data-dir=${userData}`] });
      await expect((await app.firstWindow()).getByRole('heading', { name: '帧织' })).toBeVisible();
      await app.close();
      app = await _electron.launch({
        args: [desktop, `--user-data-dir=${userData}`],
        env: { ...process.env, ELECTRON_RENDERER_URL: vite.resolvedUrls!.local[0] },
      });
      page = await app.firstWindow();
    }
    await expect(page.getByRole('heading', { name: '帧织' })).toBeVisible();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    panorama = Buffer.from(
      await page.evaluate(() => {
        const canvas = document.createElement('canvas');
        canvas.width = 2880;
        canvas.height = 1440;
        const ctx = canvas.getContext('2d')!;
        const gradient = ctx.createLinearGradient(0, 0, canvas.width, 0);
        gradient.addColorStop(0, '#304050');
        gradient.addColorStop(0.5, '#c09868');
        gradient.addColorStop(1, '#304050');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#507050';
        ctx.fillRect(0, 900, canvas.width, 540);
        return canvas.toDataURL('image/png').split(',')[1];
      }),
      'base64',
    );
    const globalTexture = await page.evaluate(async (base64) => {
      const bridge = (
        window as unknown as {
          frameLoom: { getEngineConnection(): Promise<{ baseUrl: string; token: string }> };
        }
      ).frameLoom;
      const { baseUrl, token } = await bridge.getEngineConnection();
      const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
      const uploaded = await fetch(`${baseUrl}/media`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream' },
        body: bytes,
      });
      if (!uploaded.ok) throw new Error(await uploaded.text());
      const { sha256 } = (await uploaded.json()) as { sha256: string };
      const response = await fetch(`frame-media://${sha256}`);
      const bitmap = await createImageBitmap(await response.blob());
      const gl = document.createElement('canvas').getContext('webgl2')!;
      const texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
      const result = { width: bitmap.width, height: bitmap.height, error: gl.getError() };
      bitmap.close();
      gl.deleteTexture(texture);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return result;
    }, panorama.toString('base64'));
    expect(globalTexture).toEqual({ width: 2880, height: 1440, error: 0 });
    const address = upstream.address();
    if (!address || typeof address === 'string') throw new Error('模拟服务地址无效');
    const channel = await addMediaChannel(
      page,
      `http://127.0.0.1:${address.port}/v1`,
      'fixture-local',
    );
    const model = await addMediaModel(page, channel.id, 'openai-images', '全景测试模型');
    await engineApi(page, '/model-defaults', 'PUT', { image: model.id });
    const project = (await engineApi(page, '/projects', 'POST', {
      name: '全景验收',
      location: userData,
    })) as { id: string };
    const creative = (await engineApi(page, `/projects/${project.id}/pages`, 'POST', {
      name: '全景创作',
    })) as { id: string };
    await page.getByRole('link', { name: '项目库', exact: true }).first().click();
    await page.getByRole('link', { name: '打开项目 全景验收', exact: true }).click();
    await page.getByRole('tab', { name: '创作页', exact: true }).click();
    await page.getByRole('heading', { name: '全景创作', exact: true }).click();
    await page
      .getByLabel('上传图片或视频', { exact: true })
      .setInputFiles(fileURLToPath(new URL('./fixtures/reference-256.png', import.meta.url)));
    const source = page.locator('.react-flow__node-image').first();
    await expect(source.locator('img')).toBeVisible();
    await source.click({ position: { x: 5, y: 5 } });
    await page.getByRole('button', { name: '转全景', exact: true }).click();
    await page.getByLabel('编辑模型').selectOption(model.id);
    const panel = page.getByRole('dialog', { name: '转 720° 全景图' });
    await expect(panel.getByText(/输出尺寸：2880×1440/)).toBeVisible();
    for (const value of ['light', 'dark'] as const) {
      await theme(page, value);
      await page.screenshot({
        path: test.info().outputPath(`panorama-panel-${value}.png`),
        animations: 'disabled',
      });
    }
    await page.setViewportSize({ width: 720, height: 560 });
    await page.screenshot({
      path: test.info().outputPath('panorama-panel-minimum.png'),
      animations: 'disabled',
    });
    await page.setViewportSize({ width: 1120, height: 760 });
    await panel.getByRole('button', { name: '确认', exact: true }).click();
    await expect.poll(() => requests.length).toBe(1);
    expect(requests[0]).toContain('2880x1440');
    await expect
      .poll(async () => ((await engineApi(page, '/generation-jobs')) as GenerationJob[])[0]?.status)
      .toBe('succeeded');
    await expect(page.getByText('720°', { exact: true })).toHaveCount(1);
    await page.getByRole('button', { name: '查看全景', exact: true }).click();
    const viewer = page.getByRole('dialog', { name: '720° 全景查看' });
    await expect(viewer.getByRole('button', { name: '截取当前视角' })).toBeEnabled();
    for (const value of ['light', 'dark'] as const) {
      await theme(page, value);
      await page.screenshot({
        path: test.info().outputPath(`panorama-viewer-${value}.png`),
        animations: 'disabled',
      });
    }
    await page.setViewportSize({ width: 720, height: 560 });
    await page.screenshot({
      path: test.info().outputPath('panorama-viewer-minimum.png'),
      animations: 'disabled',
    });
    await page.setViewportSize({ width: 1120, height: 760 });
    const surface = viewer.getByRole('application', { name: '全景视角' });
    await surface.focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowUp');
    await viewer.getByRole('button', { name: '重置视角' }).click();
    await viewer.getByRole('button', { name: '截取当前视角' }).click();
    await expect(page.locator('.react-flow__node-image')).toHaveCount(3);
    await viewer.getByRole('button', { name: '四向截取' }).click();
    await expect(page.locator('.react-flow__node-image')).toHaveCount(7);
    await viewer.getByRole('button', { name: '关闭', exact: true }).click();
    const endpoint = `/projects/${project.id}/pages/${creative.id}`;
    let saved: CanvasRecord;
    await expect
      .poll(async () => {
        saved = (await engineApi(page, endpoint)) as CanvasRecord;
        return saved.document.nodes.length;
      })
      .toBe(7);
    const captures = saved!.document.nodes.filter((node) => node.title?.startsWith('全景'));
    expect(captures).toHaveLength(5);
    for (const node of captures)
      expect(node.data).toMatchObject({
        versions: [expect.objectContaining({ width: 1536, height: 864 })],
      });
    const captureHash = (
      captures.find((node) => node.title === '全景当前视角')!.data as CanvasMediaData
    ).versions[0].sha256;
    const pixels = await page.evaluate(
      async ({ hash, projectId }) => {
        const bitmap = await createImageBitmap(
          await (await fetch(`frame-project://${projectId}/media/${hash}`)).blob(),
        );
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(bitmap, 0, 0);
        bitmap.close();
        return {
          center: [...ctx.getImageData(768, 432, 1, 1).data],
          bottom: [...ctx.getImageData(768, 820, 1, 1).data],
        };
      },
      { hash: captureHash, projectId: project.id },
    );
    for (const [index, expected] of [192, 152, 104].entries())
      expect(Math.abs(pixels.center[index] - expected)).toBeLessThan(5);
    for (const [index, expected] of [80, 112, 80].entries())
      expect(Math.abs(pixels.bottom[index] - expected)).toBeLessThan(5);
    expect(saved!.document.edges).toHaveLength(6);
    await page.getByRole('region', { name: '画布编辑区' }).click({ position: { x: 10, y: 10 } });
    await page.keyboard.press('Control+z');
    await expect(page.locator('.react-flow__node-image')).toHaveCount(3);
    await source.click({ position: { x: 5, y: 5 } });
    await page.getByRole('button', { name: '转全景', exact: true }).click();
    await page.getByLabel('编辑模型').selectOption(model.id);
    await page
      .getByRole('dialog', { name: '转 720° 全景图' })
      .getByRole('button', { name: '确认', exact: true })
      .click();
    await expect
      .poll(
        async () =>
          ((await engineApi(page, '/generation-jobs')) as GenerationJob[]).filter(
            (job) => job.status === 'succeeded',
          ).length,
      )
      .toBe(2);
    const jobs = (await engineApi(page, '/generation-jobs')) as GenerationJob[];
    const wrong = jobs.find((job) => job.outputs[0]?.width === 256)!;
    expect(wrong.diagnostic?.message).toContain('输出不是 2:1');
    await expect(page.getByText('输出不是 2:1，不能作为全景查看', { exact: true })).toBeVisible();
    await expect(page.getByText('720°', { exact: true })).toHaveCount(1);
    expect(requests).toHaveLength(2);
    expect(errors).toEqual([]);
    console.log(
      '全景验收',
      JSON.stringify({ packaged, captures: captures.length, requests: requests.length, errors }),
    );
  } finally {
    await disposeTestApp(app);
    await browser?.close();
    await vite?.close();
    if (child && child.exitCode === null) {
      const exited = once(child, 'exit');
      child.kill();
      await exited;
    }
    await new Promise<void>((done) => upstream.close(() => done()));
    await rm(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});
