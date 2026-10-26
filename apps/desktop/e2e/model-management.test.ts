import { openProjectCanvas } from './project-canvas.fixture';
import { expect, test, _electron, type ElectronApplication } from '@playwright/test';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

test('界面配置渠道与默认模型，明暗主题及重启保留', async ({}, info) => {
  const upstream = createServer((request, response) => {
    if (request.method === 'GET') {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ data: [{ id: 'local-chat' }] }));
      return;
    }
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk: string) => {
      body += chunk;
    });
    request.on('end', () => {
      const payload = JSON.parse(body) as { tools?: unknown };
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const events = [
        {
          id: 'chat_1',
          choices: [
            {
              index: 0,
              delta: { role: 'assistant', content: '文本链路正常。' },
              finish_reason: null,
            },
          ],
        },
        ...(payload.tools
          ? [
              {
                id: 'chat_1',
                choices: [
                  {
                    index: 0,
                    delta: {
                      tool_calls: [
                        {
                          index: 0,
                          id: 'call_1',
                          type: 'function',
                          function: { name: 'connection_probe', arguments: '{"value":"OK"}' },
                        },
                      ],
                    },
                    finish_reason: null,
                  },
                ],
              },
            ]
          : []),
        {
          id: 'chat_1',
          choices: [{ index: 0, delta: {}, finish_reason: payload.tools ? 'tool_calls' : 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        },
      ];
      for (const event of events) response.write(`data: ${JSON.stringify(event)}\n\n`);
      response.end();
    });
  });
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  const remote = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}/v1`;
  const userData = await mkdtemp(join(tmpdir(), 'frame-loom-model-ui-'));
  const desktop = resolve(fileURLToPath(new URL('..', import.meta.url)));
  let app: ElectronApplication | undefined;
  try {
    app = await _electron.launch({ args: [desktop, `--user-data-dir=${userData}`] });
    let page = await app.firstWindow();
    // 清除 Playwright 的默认明亮模拟，检查 Electron 驱动的实际主题。
    await page.emulateMedia({ colorScheme: null });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await expect(page.getByRole('heading', { name: '帧织' })).toBeVisible();
    await page.getByRole('button', { name: '设置中心' }).click();
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await page.getByRole('tab', { name: '模型服务' }).click();
    await page.getByRole('button', { name: '添加渠道' }).click();
    await page.getByLabel('渠道名称').fill('本地模拟渠道');
    await page.getByLabel('API 格式').selectOption('openai-completions');
    await page.getByLabel('接口地址').fill(remote);
    await page.getByLabel('API 密钥').fill('sk-e2e-private-1234');
    await page.getByRole('button', { name: '拉取模型' }).click();
    await page.getByLabel(/local-chat/).check();
    await page.getByRole('button', { name: '添加所选（1）' }).click();
    const card = page.getByRole('group', { name: 'local-chat' });
    await card.getByLabel('模型类别').selectOption('chat');
    await expect(card.getByLabel('调用协议')).toHaveValue('openai-completions');
    await card.getByLabel('显示名称').fill('本地文本模型');
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await page.getByRole('button', { name: '编辑 本地模拟渠道' }).click();
    await page.getByRole('button', { name: '测试渠道' }).click();
    await expect(page.getByText(/地址与鉴权通过/)).toBeVisible();
    await page.getByRole('button', { name: '测试模型' }).click();
    await expect(page.getByText(/两步测试通过/)).toBeVisible();
    await page.getByRole('button', { name: '返回渠道列表' }).click();
    await page.getByRole('tab', { name: '默认模型' }).click();
    await page
      .getByRole('combobox', { name: '文本', exact: true })
      .selectOption({ label: '本地模拟渠道 / 本地文本模型' });
    await page.getByRole('tab', { name: '模型服务' }).click();
    for (const source of ['light', 'dark']) {
      await page.evaluate(`window.frameLoom.theme.set('${source}')`);
      await page.reload();
      await expect(page.locator('body')).toHaveCSS(
        'background-color',
        source === 'dark' ? 'rgb(13, 13, 15)' : 'rgb(246, 247, 249)',
      );
      await expect(page.getByText(/1 个模型/)).toBeVisible();
      await page.screenshot({ path: info.outputPath(`model-services-${source}.png`) });
      await page.getByRole('button', { name: '编辑 本地模拟渠道' }).click();
      await expect(page.getByText(/两步测试通过/)).toBeVisible();
      await page.screenshot({ path: info.outputPath(`channel-editor-${source}.png`) });
      await page.getByRole('button', { name: '返回渠道列表' }).click();
      const panel = page.getByRole('tabpanel', { name: '模型服务' });
      expect(
        await panel.evaluate(
          (element: { scrollWidth: number; clientWidth: number }) =>
            element.scrollWidth <= element.clientWidth,
        ),
      ).toBe(true);
      await page.getByRole('tab', { name: '对象存储' }).click();
      await expect(page.getByRole('heading', { name: '对象存储' })).toBeVisible();
      await expect(page.getByText('素材与隐私')).toBeVisible();
      await page.screenshot({ path: info.outputPath(`object-storage-${source}.png`) });
      const storagePanel = page.getByRole('tabpanel', { name: '对象存储' });
      expect(
        await storagePanel.evaluate(
          (element: { scrollWidth: number; clientWidth: number }) =>
            element.scrollWidth <= element.clientWidth,
        ),
      ).toBe(true);
      await page.getByRole('tab', { name: '模型服务' }).click();
      await page.getByRole('button', { name: '关闭', exact: true }).click();
      await expect(page.getByRole('link', { name: '模型测试' })).toHaveCount(0);
      await openProjectCanvas(page, app);
      await expect(page.getByRole('region', { name: '画布编辑区' })).toBeVisible();
      await page.screenshot({ path: info.outputPath(`project-canvas-${source}.png`) });
      await page.getByRole('button', { name: '设置中心' }).click();
      await page.getByRole('button', { name: '设置', exact: true }).click();
      await page.getByRole('tab', { name: '模型服务' }).click();
    }
    expect(errors).toEqual([]);
    await app.close();
    app = undefined;
    app = await _electron.launch({ args: [desktop, `--user-data-dir=${userData}`] });
    page = await app.firstWindow();
    await page.getByRole('button', { name: '设置中心' }).click();
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await page.getByRole('tab', { name: '模型服务' }).click();
    await expect(page.getByText(/密钥：••••1234/)).toBeVisible();
    await page.getByRole('button', { name: '编辑 本地模拟渠道' }).click();
    await expect(page.getByRole('group', { name: '本地文本模型' })).toBeVisible();
    await page.getByRole('tab', { name: '默认模型' }).click();
    await expect(page.getByRole('combobox', { name: '文本', exact: true })).toHaveValue(/\S+/);
  } finally {
    await app?.close();
    upstream.closeAllConnections();
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
    await rm(userData, { recursive: true, force: true });
  }
});
