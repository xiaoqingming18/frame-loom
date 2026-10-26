import { expect, test, _electron, type Page, type ElectronApplication } from '@playwright/test';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CanvasRecord,
  Channel,
  ChannelModelList,
  GenerationJob,
  MediaFile,
  type CanvasDocument,
} from '@frame-loom/contracts';

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

test('图片节点验收：模型回退、双参考编号与旧文档重启补写', async () => {
  test.setTimeout(120_000);
  const png = await readFile(new URL('./fixtures/reference-256.png', import.meta.url));
  let finishLegacy: (() => void) | undefined;
  const upstream = createServer((request, response) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk: string) => (body += chunk));
    request.on('end', () => {
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
    const channel = Channel.parse(
      await api(page, '/channels', 'POST', {
        name: '验收模拟渠道',
        apiFormat: 'openai-completions',
        baseUrl: `http://127.0.0.1:${(upstream.address() as AddressInfo).port}/v1`,
        enabled: true,
        models: ['gpt-image-2.5', 'gpt-image-1'].map((id) => ({
          upstreamModelId: id,
          displayName: id,
          kind: 'image',
          protocol: 'openai-images',
          profileId: null,
          overrides: {},
          enabled: true,
        })),
      }),
    );
    const models = ChannelModelList.parse(await api(page, `/channels/${channel.id}/models`));
    const model = models.find((item) => item.upstreamModelId === 'gpt-image-2.5')!;
    await api(page, '/model-defaults', 'PUT', { image: model.id });
    await page.getByRole('link', { name: '画布测试' }).click();
    for (const path of ['./fixtures/reference-256.png', '../resources/icon.png']) {
      await page
        .getByLabel('上传图片或视频', { exact: true })
        .setInputFiles(fileURLToPath(new URL(path, import.meta.url)));
    }
    await expect(page.locator('.react-flow__node-image img')).toHaveCount(2);
    await expect(page.getByRole('status', { name: '画布保存状态' })).toHaveText('已保存');
    await page.getByRole('link', { name: '项目库' }).click();
    const record = CanvasRecord.parse(await api(page, '/canvases/lab'));
    const sources = record.document.nodes;
    const document: CanvasDocument = {
      schemaVersion: 1,
      nodes: [
        ...sources,
        {
          id: 'target',
          type: 'image',
          typeVersion: 2,
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
              resolution: '4K',
              quality: 'max',
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
    await api(page, '/canvases/lab', 'PUT', { revision: record.revision, document });
    await page.getByRole('link', { name: '画布测试' }).click();
    await page.locator('.react-flow__node[data-id="target"]').click();
    await page.getByRole('button', { name: '生成模型', exact: true }).click();
    await page.getByRole('button', { name: /^gpt-image-1 / }).click();
    await expect(page.getByText(/已按新模型调整/)).toBeVisible();
    await expect(page.getByRole('button', { name: '生成参数', exact: true })).toContainText(
      '3:2 · 高 · 透明',
    );
    await page.getByRole('button', { name: '生成参数', exact: true }).click();
    await expect(page.getByRole('radio', { name: '比例 21:9', exact: true })).toBeDisabled();
    await expect(page.getByRole('region', { name: '清晰度', exact: true })).toHaveCount(0);
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
          return jobs.find((job) => job.request.prompt === expected)?.status;
        })
        .toBe('succeeded');
      const jobs = (await api(page, '/generation-jobs')) as GenerationJob[];
      const job = jobs.find((job) => job.request.prompt === expected)!;
      expect(job.request.inputs.map((input) => input.sha256)).toEqual(
        [...sources]
          .reverse()
          .map((node) => (node.data as { versions: MediaFile[] }).versions[0].sha256),
      );
      expect(job.request.params).toEqual({
        aspectRatio: '3:2',
        quality: 'high',
        background: 'transparent',
      });
      await expect(page.getByRole('button', { name: '生成图片', exact: true })).toBeEnabled();
    }

    await page.getByRole('link', { name: '项目库' }).click();
    const job = GenerationJob.parse(
      await api(page, '/generation-jobs', 'POST', {
        modelId: model.id,
        mode: 'text',
        prompt: '旧文档补写',
        params: {},
        inputs: [],
        source: 'canvas',
      }),
    );
    await expect.poll(() => !!finishLegacy).toBe(true);
    const latest = CanvasRecord.parse(await api(page, '/canvases/lab'));
    await api(page, '/canvases/lab', 'PUT', {
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
    await page.getByRole('link', { name: '画布测试' }).click();
    await expect(page.locator('.react-flow__node-image img')).toBeVisible();
    await expect(page.getByRole('status', { name: '画布保存状态' })).toHaveText('已保存');
    const migrated = CanvasRecord.parse(await api(page, '/canvases/lab'));
    expect(migrated.document.nodes[0]).toMatchObject({
      typeVersion: 2,
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
        CanvasRecord.parse(await api(page, '/canvases/lab')).document.nodes[0].data as {
          versions: unknown[];
        }
      ).versions,
    ).toHaveLength(1);
  } finally {
    finishLegacy?.();
    await app?.close();
    upstream.closeAllConnections();
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
    await rm(userData, { recursive: true, force: true });
  }
});
