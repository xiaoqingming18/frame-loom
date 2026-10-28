import { expect, test, _electron, chromium, type Page } from '@playwright/test';
import { createServer } from 'vite';
import { RendererConfigFactory, resolveConfig } from 'electron-vite';
import { createServer as createHttpServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import {
  Channel,
  ChannelModelList,
  ModelImportPackage,
  type GenerationJob,
} from '@frame-loom/contracts';
import { openProjectCanvas } from './project-canvas.fixture';

const desktop = resolve(fileURLToPath(new URL('..', import.meta.url)));

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

test('真实 Vite Worker 检测及旧目录模型的 UI／提交能力一致', async () => {
  test.setTimeout(120_000);
  const userData = await mkdtemp(join(tmpdir(), 'loom-runtime-dev-'));
  const png = await readFile(new URL('./fixtures/reference-256.png', import.meta.url));
  let submissions = 0;
  const upstream = createHttpServer((request, response) => {
    request.resume();
    request.on('end', () => {
      submissions++;
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ data: [{ b64_json: png.toString('base64') }] }));
    });
  });
  await new Promise<void>((done) => upstream.listen(0, '127.0.0.1', done));
  const { config } = await resolveConfig({ root: desktop }, 'serve');
  const renderer = await new RendererConfigFactory(
    config!.renderer!,
    {},
    { root: desktop },
  ).build();
  const vite = await createServer({
    ...renderer,
    configFile: false,
    server: { ...renderer.server, port: 0 },
  });
  await vite.listen();
  let app = await _electron.launch({ args: [desktop, `--user-data-dir=${userData}`] });
  try {
    await expect((await app.firstWindow()).getByRole('heading', { name: '帧织' })).toBeVisible();
    await app.close();
    // 只修改本测试刚创建的目录，模拟已有初始化标记的历史内置档案。
    const db = new DatabaseSync(join(userData, 'data/frame-loom.sqlite'));
    try {
      const row = db
        .prepare("SELECT package_json FROM model_catalog WHERE id = 'catalog'")
        .get() as { package_json: string };
      const catalog = ModelImportPackage.parse(JSON.parse(row.package_json));
      for (const definition of catalog.definitions)
        if (definition.kind === 'image') delete definition.profile.imageEditCapabilities;
      db.prepare("UPDATE model_catalog SET package_json = ? WHERE id = 'catalog'").run(
        JSON.stringify(catalog),
      );
      db.prepare("DELETE FROM app_meta WHERE key = 'image_edit_capabilities_v1'").run();
    } finally {
      db.close();
    }
    app = await _electron.launch({
      args: [desktop, `--user-data-dir=${userData}`],
      env: { ...process.env, ELECTRON_RENDERER_URL: vite.resolvedUrls!.local[0] },
    });
    const page = await app.firstWindow();
    const errors: string[] = [];
    const resources: { url: string; status: number }[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.context().on('response', (response) => {
      if (/mediapipe|\.tflite/.test(response.url()))
        resources.push({ url: response.url(), status: response.status() });
    });
    const remote = upstream.address();
    if (!remote || typeof remote === 'string') throw new Error('模拟服务地址无效');
    const channel = Channel.parse(
      await api(page, '/channels', 'POST', {
        name: '旧目录模拟渠道',
        apiFormat: 'openai-completions',
        apiKey: 'fixture-local',
        baseUrl: `http://127.0.0.1:${remote.port}/v1`,
        enabled: true,
        models: [
          {
            definitionId: 'openai-images-gpt-image-2.5',
            connectionId: 'openai-images',
            upstreamModelId: 'gpt-image-2.5',
            displayName: '旧模型',
            kind: 'image',
            protocol: 'openai-images',
            profileId: null,
            overrides: {},
            enabled: true,
          },
          {
            definitionId: 'gemini-image-default',
            connectionId: 'gemini-image',
            upstreamModelId: 'gemini-2.5-flash-image',
            displayName: '语义编辑模型',
            kind: 'image',
            protocol: 'gemini-image',
            profileId: null,
            overrides: {},
            enabled: true,
          },
        ],
      }),
    );
    const models = ChannelModelList.parse(await api(page, `/channels/${channel.id}/models`));
    const model = models.find((item) => item.protocol === 'openai-images')!;
    const semantic = models.find((item) => item.protocol === 'gemini-image')!;
    expect(model.effectiveProfile?.imageEditCapabilities).toMatchObject({
      operations: ['angle', 'lighting', 'emotion'],
      mask: false,
    });
    await api(page, '/model-defaults', 'PUT', { image: model.id });
    await openProjectCanvas(page, app);
    await page
      .getByLabel('上传图片或视频', { exact: true })
      .setInputFiles(fileURLToPath(new URL('./fixtures/reference-256.png', import.meta.url)));
    const sourceNode = page.locator('.react-flow__node-image').first();
    await expect(sourceNode.locator('img')).toBeVisible();
    await sourceNode.click({ position: { x: 5, y: 5 } });
    await page.getByRole('button', { name: '多角度编辑' }).click();
    await page.getByLabel('编辑模型').selectOption(model.id);
    await page
      .getByRole('dialog', { name: '多角度编辑' })
      .getByRole('button', { name: '确认', exact: true })
      .click();
    await expect.poll(() => submissions).toBe(1);
    await expect
      .poll(async () => ((await api(page, '/generation-jobs')) as GenerationJob[])[0]?.status)
      .toBe('succeeded');
    await sourceNode.click({ position: { x: 5, y: 5 } });
    await page.getByRole('button', { name: '重打光编辑' }).click();
    await page.getByLabel('编辑模型').selectOption(model.id);
    await page
      .getByRole('dialog', { name: '重打光编辑' })
      .getByRole('button', { name: '确认', exact: true })
      .click();
    await page.getByRole('button', { name: '生成图片', exact: true }).click();
    await expect.poll(() => submissions).toBe(2);
    await expect
      .poll(
        async () =>
          ((await api(page, '/generation-jobs')) as GenerationJob[]).filter(
            (job) => job.status === 'succeeded',
          ).length,
      )
      .toBe(2);
    await sourceNode.click({ position: { x: 5, y: 5 } });
    await page.getByRole('button', { name: '表情编辑' }).click();
    await page.getByLabel('表情模型').selectOption(model.id);
    const detection = await page.evaluate(
      async (modulePath) => {
        const { detectFaces } = (await import(/* @vite-ignore */ modulePath)) as {
          detectFaces: (
            url: string,
            signal: AbortSignal,
          ) => Promise<{ faces: unknown[]; imageWidth: number; imageHeight: number }>;
        };
        const image = document.querySelector<HTMLImageElement>('img[alt="选择要编辑表情的角色"]')!;
        return detectFaces(image.src, new AbortController().signal);
      },
      `/@fs/${resolve(desktop, '../../packages/canvas/src/nodes/face-detection.ts').replaceAll('\\', '/')}`,
    );
    expect(detection).toMatchObject({
      faces: expect.any(Array),
      imageWidth: 256,
      imageHeight: 256,
    });
    await page.getByLabel('表情模型').selectOption(semantic.id);
    await expect(page.getByText('表情编辑需要 OpenAI Images 编辑协议')).toBeVisible();
    const screenshot = test.info().outputPath('emotion-protocol.png');
    await page.screenshot({ path: screenshot });
    await test.info().attach('表情协议限制', { path: screenshot, contentType: 'image/png' });
    const jobs = (await api(page, '/generation-jobs')) as GenerationJob[];
    const source = jobs[0].request.imageEdit!.source;
    const rejected = await page.evaluate(
      async ({ modelId, source }) => {
        const { baseUrl, token } = await (
          window as unknown as {
            frameLoom: { getEngineConnection(): Promise<{ baseUrl: string; token: string }> };
          }
        ).frameLoom.getEngineConnection();
        const response = await fetch(baseUrl + '/generation-jobs', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            modelId,
            mode: 'reference',
            prompt: '表情',
            source: 'test',
            params: {},
            inputs: [{ kind: 'image', role: 'reference', sha256: source.sha256 }],
            imageEdit: {
              version: 1,
              operation: 'emotion',
              source,
              targetFace: { x: 10, y: 10, width: 20, height: 20 },
              editRegion: { x: 0, y: 0, width: 100, height: 100 },
              imageWidth: 256,
              imageHeight: 256,
              presetId: 'neutral',
              intimacy: 0,
              arousal: 0,
              characterName: '角色1',
              maskMode: 'local',
            },
          }),
        });
        return { status: response.status, body: await response.text() };
      },
      { modelId: semantic.id, source },
    );
    expect(rejected.status).toBe(422);
    expect(rejected.body).toContain('表情编辑需要 OpenAI Images 编辑协议');
    expect(submissions).toBe(2);
    await page.getByLabel('表情模型').selectOption(model.id);
    await page.getByRole('button', { name: '手动框选' }).click();
    const box = (await page.getByAltText('选择要编辑表情的角色').boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.75, { steps: 5 });
    await page.mouse.up();
    await page.getByRole('button', { name: '生成表情' }).click();
    await expect(page.getByText('当前模型不支持蒙版，结果将由本地按脸部区域融合')).toBeVisible();
    await expect.poll(() => submissions).toBe(3);
    for (const extension of ['.js', '.wasm', '.tflite'])
      expect(resources.some((item) => item.url.includes(extension) && item.status === 200)).toBe(
        true,
      );
    expect(resources.some((item) => item.url.includes('?import'))).toBe(false);
    expect(errors).toEqual([]);
    expect(await page.locator('vite-error-overlay').count()).toBe(0);
    console.log(
      '开发检测与能力验收',
      JSON.stringify({ detection, resources, submissions, rejected: rejected.status }),
    );
  } finally {
    await app.close();
    await vite.close();
    upstream.closeAllConnections();
    await new Promise<void>((done) => upstream.close(() => done()));
    await rm(userData, { recursive: true, force: true });
  }
});

test('当前加固目录包 app 同源 Worker／WASM／模型真实检测', async () => {
  test.setTimeout(90_000);
  const userData = await mkdtemp(join(tmpdir(), 'loom-runtime-package-'));
  const child = spawn(
    join(desktop, 'release/win-unpacked/Frame Loom.exe'),
    ['--remote-debugging-port=0', `--user-data-dir=${userData}`],
    { windowsHide: true, stdio: 'ignore' },
  );
  let browser: Awaited<ReturnType<typeof chromium.connectOverCDP>> | undefined;
  try {
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
    const page = context.pages()[0] ?? (await context.waitForEvent('page'));
    await expect(page.getByRole('heading', { name: '帧织' })).toBeVisible();
    expect(page.url()).toContain('app://frame-loom');
    const resources: { url: string; status: number }[] = [];
    context.on('response', (response) => {
      if (/mediapipe|\.tflite/.test(response.url()))
        resources.push({ url: response.url(), status: response.status() });
    });
    const workerFile = (await readdir(join(desktop, 'out/renderer/assets'))).find((name) =>
      /^worker-.*\.js$/.test(name),
    )!;
    const result = await page.evaluate(async (workerFile) => {
      const canvas = new OffscreenCanvas(256, 256);
      canvas.getContext('2d')!.fillRect(0, 0, 256, 256);
      const image = canvas.transferToImageBitmap();
      const worker = new Worker(`/assets/${workerFile}`, { type: 'module' });
      try {
        return await new Promise<{ faces?: unknown[]; error?: string }>((resolve, reject) => {
          worker.onmessage = (event: MessageEvent<{ faces?: unknown[]; error?: string }>) =>
            resolve(event.data);
          worker.onerror = (event) => reject(new Error(event.message));
          worker.postMessage({ id: 1, image }, [image]);
        });
      } finally {
        worker.terminate();
      }
    }, workerFile);
    expect(result.error).toBeUndefined();
    expect(result.faces).toEqual(expect.any(Array));
    for (const extension of ['.js', '.wasm', '.tflite'])
      expect(
        resources.some(
          (item) =>
            item.url.startsWith('app://frame-loom/') &&
            item.url.includes(extension) &&
            item.status === 200,
        ),
      ).toBe(true);
    console.log('目录包真实检测', JSON.stringify({ result, resources }));
    const exited = once(child, 'exit');
    await page.getByRole('button', { name: '关闭窗口', includeHidden: true }).click();
    await exited;
  } finally {
    await browser?.close();
    if (child.exitCode === null) {
      const exited = once(child, 'exit');
      child.kill();
      await exited;
    }
    await rm(userData, { recursive: true, force: true });
  }
});
