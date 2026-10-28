import { expect, test, _electron, type ElectronApplication } from '@playwright/test';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

test('渠道、协议与能力编辑、文本与 TTS 测试、默认模型及明暗最小窗口', async ({}, info) => {
  test.setTimeout(180_000);
  const key = 'local-e2e-only-1234';
  const requests: { method: string; path: string; body: Record<string, unknown> }[] = [];
  const violations: string[] = [];
  const upstream = createServer((request, response) => {
    void (async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk as Uint8Array));
      const path = request.url ?? '';
      const method = request.method ?? '';
      const body = chunks.length
        ? (JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown>)
        : {};
      requests.push({ method, path, body });
      const catalog = method === 'GET' && path === '/v1/models';
      const chat = method === 'POST' && path === '/v1/responses';
      const tts = method === 'POST' && path === '/v1beta/models/local-tts:generateContent';
      if (!catalog && !chat && !tts) {
        violations.push(`${method} ${path}`);
        response.writeHead(404).end();
        return;
      }
      if (
        tts
          ? request.headers['x-goog-api-key'] !== key
          : request.headers.authorization !== `Bearer ${key}`
      ) {
        violations.push(`鉴权 ${path}`);
        response.writeHead(401).end();
        return;
      }
      if (catalog) {
        response.setHeader('Content-Type', 'application/json');
        response.end(
          JSON.stringify({
            data: [
              { id: 'local-chat', supported_endpoint_types: ['openai-response'] },
              {
                id: 'local-tts',
                supported_endpoint_types: ['gemini'],
                architecture: { output_modalities: ['audio'] },
              },
              { id: 'local-video', supported_endpoint_types: ['openai-video'] },
            ],
          }),
        );
      } else if (chat) {
        response.writeHead(200, { 'Content-Type': 'text/event-stream' });
        const events = [
          { type: 'response.created', response: { id: 'r1', status: 'in_progress' } },
          {
            type: 'response.output_item.added',
            output_index: 0,
            item: { id: 'm1', type: 'message', role: 'assistant', content: [] },
          },
          { type: 'response.output_text.delta', output_index: 0, content_index: 0, delta: 'OK' },
          {
            type: 'response.output_item.done',
            output_index: 0,
            item: {
              id: 'm1',
              type: 'message',
              role: 'assistant',
              content: [{ type: 'output_text', text: 'OK', annotations: [] }],
            },
          },
          {
            type: 'response.completed',
            response: {
              id: 'r1',
              status: 'completed',
              output: [],
              usage: { input_tokens: 2, output_tokens: 1, total_tokens: 3 },
            },
          },
        ];
        for (const event of events) response.write(`data: ${JSON.stringify(event)}\n\n`);
        response.end();
      } else {
        response.setHeader('Content-Type', 'application/json');
        response.end(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      inlineData: {
                        data: Buffer.alloc(4800).toString('base64'),
                        mimeType: 'audio/L16;rate=24000',
                      },
                    },
                  ],
                },
                finishReason: 'STOP',
              },
            ],
          }),
        );
      }
    })().catch(() => {
      response.writeHead(500).end();
    });
  });
  await new Promise<void>((done) => upstream.listen(0, '127.0.0.1', done));
  const origin = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
  const userData = await mkdtemp(join(tmpdir(), 'loom-model-rebuild-'));
  let app: ElectronApplication | undefined;
  try {
    app = await _electron.launch({
      args: [resolve(fileURLToPath(new URL('..', import.meta.url))), `--user-data-dir=${userData}`],
    });
    const page = await app.firstWindow();
    await page.emulateMedia({ colorScheme: null });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.getByRole('button', { name: '设置中心' }).click();
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await page.getByRole('tab', { name: '模型服务', exact: true }).click();
    await page.getByRole('button', { name: '添加第一个渠道' }).click();
    await page.getByLabel('渠道名称').fill('本地模拟渠道');
    await page.getByLabel('服务地址', { exact: true }).fill(`${origin}/v1`);
    await page.getByLabel('API Key', { exact: true }).fill(key);
    await page.getByRole('button', { name: '保存并读取模型' }).click();
    await page.getByRole('checkbox', { name: '选择 local-chat', exact: true }).check();
    await page.getByRole('checkbox', { name: '选择 local-tts', exact: true }).check();
    await page.getByRole('checkbox', { name: '选择 local-video', exact: true }).check();
    await page.getByRole('button', { name: '添加所选 (3)' }).click();
    await page.getByRole('button', { name: 'local-video local-video', exact: true }).click();
    let editor = page.getByRole('dialog', { name: 'local-video', exact: true });
    await editor.getByRole('radio', { name: /MiniMax/ }).click();
    await editor.getByLabel('使用完整地址覆盖（可选）').fill(`${origin}/v2/video_generation`);
    await expect(editor.getByText('已根据提交地址推导查询地址')).toBeVisible();
    await expect(editor.getByRole('region', { name: '请求地址' })).toContainText(
      `${origin}/v2/query/video_generation`,
    );
    await editor.getByRole('tab', { name: '能力与参数' }).click();
    await editor.getByLabel('提示词字数', { exact: true }).fill('1200');
    await editor.getByRole('button', { name: '保存', exact: true }).click();
    await expect(editor.getByText('有未保存的修改')).toHaveCount(0);
    await editor.getByRole('button', { name: '关闭', exact: true }).click();
    const chatRow = page
      .locator('article')
      .filter({ has: page.getByRole('button', { name: 'local-chat local-chat', exact: true }) });
    await chatRow.getByRole('button', { name: '测试', exact: true }).click();
    await page.getByRole('button', { name: '开始测试' }).click();
    await expect(page.getByText('文本回复：通过')).toBeVisible();
    await page
      .getByRole('dialog', { name: '生成测试 · local-chat' })
      .getByRole('button', { name: '关闭', exact: true })
      .click();
    await page.getByRole('button', { name: 'local-tts local-tts', exact: true }).click();
    editor = page.getByRole('dialog', { name: 'local-tts', exact: true });
    await editor.getByRole('radio', { name: /Gemini/ }).click();
    await editor.getByRole('switch', { name: '启用模型', exact: true }).check();
    await editor.getByRole('button', { name: '保存', exact: true }).click();
    await expect(editor.getByText('有未保存的修改')).toHaveCount(0);
    await editor.getByRole('button', { name: '生成测试', exact: true }).click();
    await expect(page.getByText(/可能产生费用/)).toBeVisible();
    expect(
      requests.filter(
        (request) => request.method === 'POST' && request.path.includes('generateContent'),
      ),
    ).toHaveLength(0);
    await page.getByRole('button', { name: '确认并打开测试' }).click();
    await page.getByRole('button', { name: '开始测试' }).click();
    const audio = page.getByLabel('TTS 测试结果');
    await expect(audio).toBeVisible();
    await expect
      .poll(() => audio.evaluate((element: HTMLAudioElement) => element.readyState))
      .toBeGreaterThanOrEqual(2);
    await audio.evaluate((element: HTMLAudioElement) => element.play());
    await page
      .getByRole('dialog', { name: '生成测试 · local-tts' })
      .getByRole('button', { name: '关闭', exact: true })
      .click();
    await editor.getByRole('button', { name: '关闭', exact: true }).click();
    await page.getByRole('tab', { name: '默认模型', exact: true }).click();
    await page
      .getByRole('combobox', { name: '文本', exact: true })
      .selectOption({ label: '本地模拟渠道 / local-chat' });
    await page
      .getByRole('combobox', { name: 'TTS', exact: true })
      .selectOption({ label: '本地模拟渠道 / local-tts' });
    await page.getByRole('tab', { name: '模型服务', exact: true }).click();
    await page.getByRole('button', { name: /本地模拟渠道/ }).click();
    for (const theme of ['light', 'dark'] as const) {
      await page.evaluate(`window.frameLoom.theme.set('${theme}')`);
      await page.emulateMedia({ colorScheme: theme });
      await expect(page.locator('body')).toHaveCSS(
        'background-color',
        theme === 'dark' ? 'rgb(13, 13, 15)' : 'rgb(246, 247, 249)',
      );
      for (const width of [1280, 800]) {
        await page.setViewportSize({ width, height: 800 });
        await page.screenshot({
          path: info.outputPath(`channel-${theme}-${width}.png`),
          animations: 'disabled',
        });
        await page.getByRole('button', { name: 'local-tts local-tts', exact: true }).click();
        editor = page.getByRole('dialog', { name: 'local-tts', exact: true });
        for (const [tab, file] of [
          ['基本信息', 'basic'],
          ['能力与参数', 'capability'],
          ['附加参数', 'extras'],
        ]) {
          await editor.getByRole('tab', { name: tab, exact: true }).click();
          await expect(editor.getByRole('tab', { name: tab, exact: true })).toHaveAttribute(
            'aria-selected',
            'true',
          );
          await page.screenshot({
            path: info.outputPath(`editor-${file}-${theme}-${width}.png`),
            animations: 'disabled',
          });
          expect(
            await editor.evaluate((element) => element.scrollWidth <= element.clientWidth),
          ).toBe(true);
        }
        for (let i = 0; i < 15; i++) {
          await page.keyboard.press('Tab');
          expect(await editor.evaluate((element) => element.contains(document.activeElement))).toBe(
            true,
          );
        }
        await page.keyboard.press('Escape');
        await expect(editor).toHaveCount(0);
        await expect(page.getByRole('tab', { name: '模型服务', exact: true })).toBeVisible();
      }
    }
    expect(requests.filter((request) => request.path === '/v1/responses')).toHaveLength(1);
    const tts = requests.filter((request) => request.path.includes('generateContent'));
    expect(tts).toHaveLength(1);
    expect(tts[0].body).toMatchObject({ generationConfig: { responseModalities: ['AUDIO'] } });
    expect(violations).toEqual([]);
    expect(errors).toEqual([]);
  } finally {
    await app?.close();
    upstream.closeAllConnections();
    await new Promise<void>((done) => upstream.close(() => done()));
    await rm(userData, { recursive: true, force: true });
  }
});
