import { openProjectCanvas, canvasFixture } from './project-canvas.fixture';
import { expect, test, _electron, type Page, type ElectronApplication } from '@playwright/test';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getProtocol,
  ProjectPageRecord,
  GenerationJob,
  MediaFile,
  type CanvasDocument,
} from '@frame-loom/contracts';

import { addMediaChannel, addMediaModel, disposeTestApp } from './model-service.fixture';

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

test('图片节点验收：参数待确认、双参考编号与旧文档重启补写', async () => {
  test.setTimeout(120_000);
  const png = await readFile(new URL('./fixtures/reference-256.png', import.meta.url));
  const requests: string[] = [];
  let finishLegacy: (() => void) | undefined;
  const upstream = createServer((request, response) => {
    if (
      request.method !== 'POST' ||
      !['/v1/images/generations', '/v1/images/edits'].includes(request.url ?? '')
    ) {
      response.writeHead(404).end();
      return;
    }
    if (request.headers.authorization !== 'Bearer sk-image-acceptance-local') {
      response.writeHead(401).end();
      return;
    }
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk: string) => (body += chunk));
    request.on('end', () => {
      requests.push(body);
      const finish = () => {
        if (response.writableEnded || response.destroyed) return;
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify({ data: [{ b64_json: png.toString('base64') }] }));
      };
      if (body.includes('旧文档补写')) finishLegacy = finish;
      else finish();
    });
  });
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  const userData = await mkdtemp(join(tmpdir(), 'frame-loom-image-acceptance-'));
  let app: ElectronApplication | undefined;
  try {
    app = await _electron.launch({ args: [desktop, `--user-data-dir=${userData}`] });
    let page = await app.firstWindow();
    await expect(page.getByRole('heading', { name: '帧织' })).toBeVisible();
    const channel = await addMediaChannel(
      page,
      `http://127.0.0.1:${(upstream.address() as AddressInfo).port}/v1`,
      'sk-image-acceptance-local',
    );
    const model = await addMediaModel(page, channel.id, 'openai-images', '宽幅模型');
    const narrow = structuredClone(getProtocol('openai-images')!.templates.image!);
    narrow.size.tiers = narrow.size.tiers.map((tier) => ({
      ...tier,
      ratios: tier.ratios.filter((cell) => cell.ratio !== '21:9'),
    }));
    await addMediaModel(page, channel.id, 'openai-images', '窄幅模型', narrow);
    await api(page, '/model-defaults', 'PUT', { image: model.id });
    await openProjectCanvas(page, app);
    for (const path of ['./fixtures/reference-256.png', '../resources/icon.png']) {
      await page
        .getByLabel('上传图片或视频', { exact: true })
        .setInputFiles(fileURLToPath(new URL(path, import.meta.url)));
    }
    await expect(page.locator('.react-flow__node-image img')).toHaveCount(2);
    await expect(page.getByRole('status', { name: '画布保存状态' })).toHaveText('已保存');
    await page.getByRole('link', { name: '项目库', exact: true }).first().click();
    const record = ProjectPageRecord.parse(await api(page, (await canvasFixture(page)).pagePath));
    const sources = record.document.nodes;
    const document: CanvasDocument = {
      schemaVersion: 1,
      nodes: [
        ...sources,
        {
          id: 'target',
          type: 'image',
          typeVersion: 3,
          title: '引用目标',
          position: { x: 400, y: 180 },
          size: { width: 280, height: 280 },
          data: {
            versions: [],
            activeVersion: 0,
            prompt: `参考 @{${sources[0].id}} 与 @{${sources[1].id}}`,
            inputOrder: ['reference-0', 'reference-1'],
            modelId: model.id,
            params: {
              aspectRatio: '21:9',
              tier: '1K',
              quality: 'high',
              background: 'transparent',
            },
          },
        },
      ],
      edges: sources.map((node, index) => ({
        id: `reference-${index}`,
        source: node.id,
        sourceHandle: 'out',
        target: 'target',
        targetHandle: 'reference',
      })),
    };
    await api(page, (await canvasFixture(page)).pagePath, 'PUT', {
      revision: record.revision,
      document,
    });
    await openProjectCanvas(page, app);
    await page.locator('.react-flow__node[data-id="target"]').click();
    await page.getByRole('button', { name: '生成模型', exact: true }).click();
    await page.getByRole('button', { name: /^窄幅模型 / }).click();
    await expect(page.getByRole('button', { name: '生成图片', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: '生成参数', exact: true }).click();
    await page.getByRole('radio', { name: '比例 3:2', exact: true }).click();
    await page.keyboard.press('Escape');
    await page
      .getByRole('button', { name: '参考 1，Alt 加方向键排序', exact: true })
      .press('Alt+ArrowRight');
    const prompt = page.getByRole('textbox', { name: '生成提示词' });
    await expect(prompt.locator('[data-reference]')).toHaveText(['图2', '图1']);
    for (const [text, expected] of [
      [`参考 @{${sources[0].id}} 与 @{${sources[1].id}}`, '参考 图2 与 图1'],
      [`Use @{${sources[0].id}} with @{${sources[1].id}}`, 'Use Image 2 with Image 1'],
    ]) {
      await prompt.fill(text);
      await page.getByRole('button', { name: '生成图片', exact: true }).click();
      await expect(page.locator('.react-flow__node[data-id="target"] img').first()).toBeVisible();
      await expect
        .poll(async () => {
          const jobs = (await api(page, '/generation-jobs')) as GenerationJob[];
          return jobs.find(
            (job) =>
              job.request.prompt ===
              text
                .replaceAll(
                  `@{${sources[0].id}}`,
                  `@{${(sources[0].data as { versions: MediaFile[] }).versions[0].sha256}}`,
                )
                .replaceAll(
                  `@{${sources[1].id}}`,
                  `@{${(sources[1].data as { versions: MediaFile[] }).versions[0].sha256}}`,
                ),
          )?.status;
        })
        .toBe('succeeded');
      const jobs = (await api(page, '/generation-jobs')) as GenerationJob[];
      const job = jobs.find(
        (job) => job.status === 'succeeded' && job.request.prompt.startsWith(text.slice(0, 3)),
      )!;
      expect(requests.at(-1)).toContain(expected);
      expect(job.request.inputs.map((input) => input.sha256)).toEqual(
        [...sources]
          .reverse()
          .map((node) => (node.data as { versions: MediaFile[] }).versions[0].sha256),
      );
      expect(job.request.params).toEqual({
        tier: '1K',
        aspectRatio: '3:2',
        quality: 'high',
        background: 'transparent',
      });
      await expect(page.getByRole('button', { name: '生成图片', exact: true })).toBeEnabled();
    }

    await page.getByRole('link', { name: '项目库', exact: true }).first().click();
    const job = GenerationJob.parse(
      await api(page, '/generation-jobs', 'POST', {
        modelId: model.id,
        prompt: '旧文档补写',
        params: {},
        extras: {},
        inputs: [],
        source: 'canvas',
      }),
    );
    await expect.poll(() => !!finishLegacy).toBe(true);
    const latest = ProjectPageRecord.parse(await api(page, (await canvasFixture(page)).pagePath));
    await api(page, (await canvasFixture(page)).pagePath, 'PUT', {
      revision: latest.revision,
      document: {
        schemaVersion: 1,
        nodes: [
          {
            ...document.nodes[2],
            typeVersion: 1,
            data: {
              versions: [],
              activeVersion: 0,
              prompt: '旧文档补写',
              inputOrder: [],
              pendingJobId: job.id,
            },
          },
        ],
        edges: [],
      },
    });
    finishLegacy!();
    await expect
      .poll(async () => GenerationJob.parse(await api(page, `/generation-jobs/${job.id}`)).status)
      .toBe('succeeded');
    await app.close();
    app = undefined;
    app = await _electron.launch({ args: [desktop, `--user-data-dir=${userData}`] });
    page = await app.firstWindow();
    await openProjectCanvas(page, app);
    await expect(page.locator('.react-flow__node-image img')).toBeVisible();
    await expect(page.getByRole('status', { name: '画布保存状态' })).toHaveText('已保存');
    const migrated = ProjectPageRecord.parse(await api(page, (await canvasFixture(page)).pagePath));
    expect(migrated.document.nodes[0]).toMatchObject({
      typeVersion: 3,
      data: {
        pendingJobIds: [],
        versions: [expect.objectContaining({ jobId: job.id })],
      },
    });
    expect(migrated.document.nodes[0].data).not.toHaveProperty('pendingJobId');
    await page.reload();
    await expect(page.locator('.react-flow__node-image img')).toBeVisible();
    expect(
      (
        ProjectPageRecord.parse(await api(page, (await canvasFixture(page)).pagePath)).document
          .nodes[0].data as {
          versions: unknown[];
        }
      ).versions,
    ).toHaveLength(1);
  } finally {
    finishLegacy?.();
    await disposeTestApp(app);
    upstream.closeAllConnections();
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
    await rm(userData, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
});

test('图片编辑验收：角度立即提交、打光二阶段提交与表情整图写回', async () => {
  test.setTimeout(150_000);
  const png = await readFile(new URL('./fixtures/reference-256.png', import.meta.url));
  const submissions: { body: string; url?: string }[] = [];
  const upstream = createServer((request, response) => {
    if (
      request.method !== 'POST' ||
      !['/v1/images/generations', '/v1/images/edits'].includes(request.url ?? '')
    ) {
      response.writeHead(404).end();
      return;
    }
    if (request.headers.authorization !== 'Bearer sk-image-edit-local') {
      response.writeHead(401).end();
      return;
    }
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      submissions.push({ body: Buffer.concat(chunks).toString('latin1'), url: request.url });
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ data: [{ b64_json: png.toString('base64') }] }));
    });
  });
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  const userData = await mkdtemp(join(tmpdir(), 'frame-loom-image-edit-'));
  let app: ElectronApplication | undefined;
  try {
    app = await _electron.launch({ args: [desktop, `--user-data-dir=${userData}`] });
    let page = await app.firstWindow();
    const channel = await addMediaChannel(
      page,
      `http://127.0.0.1:${(upstream.address() as AddressInfo).port}/v1`,
      'sk-image-edit-local',
    );
    const model = await addMediaModel(page, channel.id, 'openai-images', '编辑模型');
    await api(page, '/model-defaults', 'PUT', { image: model.id });
    await openProjectCanvas(page, app);
    await page
      .getByLabel('上传图片或视频', { exact: true })
      .setInputFiles(fileURLToPath(new URL('./fixtures/reference-256.png', import.meta.url)));
    const sourceNode = page.locator('.react-flow__node-image').first();
    await expect(sourceNode.locator('img')).toBeVisible();
    await expect(page.getByRole('status', { name: '画布保存状态' })).toHaveText('已保存');
    const editor = page.getByRole('region', { name: '画布编辑区' });
    await editor.focus();
    await page.keyboard.press('Escape');
    await sourceNode.click({ position: { x: 5, y: 5 } });
    await page.getByRole('button', { name: '多角度编辑' }).waitFor({ state: 'visible' });
    await page.getByRole('button', { name: '多角度编辑' }).click();
    await page.getByLabel('编辑模型').selectOption(model.id);
    await page
      .getByRole('dialog', { name: '多角度编辑' })
      .getByRole('button', { name: '确认', exact: true })
      .click();
    await expect.poll(() => submissions.length).toBe(1);
    await expect
      .poll(async () => {
        const jobs = (await api(page, '/generation-jobs')) as GenerationJob[];
        return jobs.some(
          (job) => job.request.imageEdit?.operation === 'angle' && job.status === 'succeeded',
        );
      })
      .toBe(true);
    expect(submissions[0]?.url).toBe('/v1/images/edits');
    await expect(page.getByRole('status', { name: '画布保存状态' })).toHaveText('已保存');

    const saved = ProjectPageRecord.parse(await api(page, (await canvasFixture(page)).pagePath));
    const angleChild = saved.document.nodes.find(
      (node) =>
        (node.data as { imageEdit?: { operation?: string } }).imageEdit?.operation === 'angle',
    )!;
    const angleNode = page.locator(`.react-flow__node-image[data-id="${angleChild.id}"]`);
    await editor.focus();
    await page.keyboard.press('Shift+Digit1');
    await angleNode.click();
    await page.getByRole('button', { name: '重打光编辑' }).click();
    await page.getByLabel('编辑模型').selectOption(model.id);
    await page
      .getByRole('dialog', { name: '重打光编辑' })
      .getByRole('button', { name: '确认', exact: true })
      .click();
    await expect(page.getByRole('button', { name: '生成图片', exact: true })).toBeVisible();
    expect(submissions).toHaveLength(1);
    await page.getByRole('button', { name: '生成图片', exact: true }).click();
    await expect.poll(() => submissions.length).toBe(2);
    await expect
      .poll(async () => {
        const jobs = (await api(page, '/generation-jobs')) as GenerationJob[];
        return jobs.some(
          (job) => job.request.imageEdit?.operation === 'lighting' && job.status === 'succeeded',
        );
      })
      .toBe(true);

    await expect(page.getByRole('status', { name: '画布保存状态' })).toHaveText('已保存');
    const afterLighting = ProjectPageRecord.parse(
      await api(page, (await canvasFixture(page)).pagePath),
    );
    const lightingChild = afterLighting.document.nodes.find(
      (node) =>
        (node.data as { imageEdit?: { operation?: string } }).imageEdit?.operation === 'lighting',
    )!;
    await editor.focus();
    await page.keyboard.press('Shift+Digit1');
    await page.locator(`.react-flow__node-image[data-id="${lightingChild.id}"]`).click();
    await page.getByRole('button', { name: '表情编辑' }).click();
    await expect(page.getByRole('dialog', { name: '表情编辑工作区' })).toBeVisible();
    await page.getByRole('button', { name: '手动框选' }).click();
    const image = page.getByAltText('选择要编辑表情的角色');
    const box = (await image.boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.75, { steps: 5 });
    await page.mouse.up();
    await page.getByRole('button', { name: '生成表情' }).click();
    await expect.poll(() => submissions.length).toBe(3);
    await expect
      .poll(
        async () => {
          const jobs = (await api(page, '/generation-jobs')) as GenerationJob[];
          return jobs.some(
            (job) => job.request.imageEdit?.operation === 'emotion' && job.status === 'succeeded',
          );
        },
        { timeout: 30_000 },
      )
      .toBe(true);
    const finished = (await api(page, '/generation-jobs')) as GenerationJob[];
    const emotionJob = finished.find((job) => job.request.imageEdit?.operation === 'emotion')!;
    expect(emotionJob.outputs).toHaveLength(1);
    expect(emotionJob.outputs[0]).toMatchObject({ width: 256, height: 256, mime: 'image/png' });
    const pagePath = (await canvasFixture(page)).pagePath;
    await expect
      .poll(async () => {
        const saved = ProjectPageRecord.parse(await api(page, pagePath));
        return saved.document.nodes
          .filter(
            (node) =>
              (node.data as { imageEdit?: { operation?: string }; versions?: unknown[] }).imageEdit
                ?.operation === 'emotion',
          )
          .map((node) => (node.data as { versions: unknown[] }).versions.length);
      })
      .toEqual([1]);
    await expect(page.getByRole('status', { name: '画布保存状态' })).toHaveText('已保存');
    await app.close();
    app = await _electron.launch({ args: [desktop, `--user-data-dir=${userData}`] });
    page = await app.firstWindow();
    await openProjectCanvas(page, app);
    const restored = ProjectPageRecord.parse(await api(page, pagePath));
    const emotionChild = restored.document.nodes.find(
      (node) =>
        (node.data as { imageEdit?: { operation?: string } }).imageEdit?.operation === 'emotion',
    );
    expect(emotionChild?.data).toMatchObject({
      versions: [{ sha256: emotionJob.outputs[0].sha256, width: 256, height: 256 }],
    });
    expect(submissions).toHaveLength(3);
  } finally {
    await disposeTestApp(app);
    upstream.closeAllConnections();
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
    await rm(userData, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
});
