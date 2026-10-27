import { expect, test, _electron, type ElectronApplication } from '@playwright/test';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

test('TTS 音色保存、收费试听、真实元数据与重启播放在明暗及最小窗口可用', async ({}, info) => {
  const audio = Buffer.alloc(32044);
  audio.write('RIFF');
  audio.writeUInt32LE(audio.length - 8, 4);
  audio.write('WAVEfmt ', 8);
  audio.writeUInt32LE(16, 16);
  audio.writeUInt16LE(1, 20);
  audio.writeUInt16LE(1, 22);
  audio.writeUInt32LE(16000, 24);
  audio.writeUInt32LE(32000, 28);
  audio.writeUInt16LE(2, 32);
  audio.writeUInt16LE(16, 34);
  audio.write('data', 36);
  audio.writeUInt32LE(32000, 40);
  const requests: { path: string; body: unknown }[] = [];
  const server = createServer((req, res) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => {
      body += chunk;
    });
    req.on('end', () => {
      requests.push({ path: req.url!, body: JSON.parse(body) as unknown });
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/tenant/v1/get_voice')
        res.end(
          JSON.stringify({
            base_resp: { status_code: 0 },
            voice_cloning: [{ voice_id: 'my-private', voice_name: '私有音色' }],
          }),
        );
      else if (req.url === '/tenant/v1/t2a_v2')
        res.end(
          JSON.stringify({
            data: { audio: audio.toString('hex') },
            extra_info: { audio_format: 'mp3' },
          }),
        );
      else res.writeHead(404).end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const userData = await mkdtemp(join(tmpdir(), 'loom-tts-ui-'));
  const desktop = resolve(fileURLToPath(new URL('..', import.meta.url)));
  let app: ElectronApplication | undefined;
  try {
    const boot = async () => {
      app = await _electron.launch({ args: [desktop, `--user-data-dir=${userData}`] });
      const page = await app.firstWindow();
      await page.getByRole('button', { name: '设置中心' }).click();
      await page.getByRole('button', { name: '设置', exact: true }).click();
      await page.getByRole('tab', { name: '模型服务' }).click();
      return page;
    };
    let page = await boot();
    await page.getByRole('button', { name: '添加渠道' }).click();
    await page.getByLabel('渠道名称').fill('语音渠道');
    await page
      .getByLabel('接口地址', { exact: true })
      .fill(`http://127.0.0.1:${(server.address() as AddressInfo).port}/tenant`);
    await page.getByLabel('API 密钥').fill('fixture-key');
    await page.getByRole('button', { name: '添加模型' }).click();
    await page.getByLabel('逻辑模型').selectOption('minimax-t2a-default');
    await page.getByLabel('模型 ID').fill('speech-2.6-hd');
    await page.getByLabel('显示名称').fill('测试配音');
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await page.getByRole('button', { name: '编辑 语音渠道' }).click();
    for (const theme of ['light', 'dark']) {
      await page.evaluate(`window.frameLoom.theme.set('${theme}')`);
      await page.emulateMedia({ colorScheme: theme as 'light' | 'dark' });
      await expect(page.locator('body')).toHaveCSS(
        'background-color',
        theme === 'dark' ? 'rgb(13, 13, 15)' : 'rgb(246, 247, 249)',
      );
      await page.setViewportSize({ width: 800, height: 800 });
      await page.getByRole('button', { name: '音色管理与试听' }).click();
      const dialog = page.getByRole('dialog', { name: '音色管理与试听' });
      await dialog.getByLabel('音色 ID', { exact: true }).fill('');
      await expect(dialog.getByRole('button', { name: '确认调用并承担可能费用' })).toBeDisabled();
      await dialog.getByLabel('音色 ID', { exact: true }).fill('my-private');
      await dialog.getByLabel('音色名称', { exact: true }).fill('我的配音');
      await dialog.getByRole('button', { name: '保存到当前账号与模型' }).click();
      await expect(dialog.getByLabel('音色目录')).toContainText('我的配音');
      await page.screenshot({
        path: info.outputPath(`tts-voice-${theme}.png`),
        animations: 'disabled',
      });
      await page.keyboard.press('Escape');
    }
    expect(requests).toEqual([]);
    await page.getByRole('button', { name: '音色管理与试听' }).click();
    await page.getByRole('button', { name: '拉取供应商音色' }).click();
    await page.getByLabel('音色目录').selectOption('my-private');
    await page.getByRole('button', { name: '确认调用并承担可能费用' }).click();
    await expect(page.getByText(/测试任务：succeeded/)).toBeVisible();
    await expect(page.getByRole('button', { name: '音色管理与试听' })).toBeEnabled();
    await expect(page.getByText('配置有未保存改动，请保存后再测试。')).toHaveCount(0);
    await expect(page.getByText('audio/wav · 1 秒 · 16000 Hz · 1 声道')).toBeVisible();
    const player = page.getByLabel('语音测试结果');
    await expect
      .poll(() => player.evaluate((element: HTMLAudioElement) => element.readyState))
      .toBeGreaterThanOrEqual(1);
    await player.evaluate((element: HTMLAudioElement) => element.play());
    await page.screenshot({ path: info.outputPath('tts-result.png'), animations: 'disabled' });
    expect(requests.filter((request) => request.path.endsWith('/t2a_v2'))).toHaveLength(1);
    expect(requests.at(-1)).toMatchObject({
      path: '/tenant/v1/t2a_v2',
      body: { voice_setting: { voice_id: 'my-private' } },
    });
    await app!.close();
    app = undefined;
    page = await boot();
    await page.getByRole('button', { name: '编辑 语音渠道' }).click();
    await expect(page.getByLabel('语音测试结果')).toBeVisible();
    await page.getByRole('button', { name: '音色管理与试听' }).click();
    await expect(page.getByLabel('音色目录')).toContainText('我的配音');
    expect(requests.filter((request) => request.path.endsWith('/t2a_v2'))).toHaveLength(1);
  } finally {
    await app?.close();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await rm(userData, { recursive: true, force: true });
  }
});
