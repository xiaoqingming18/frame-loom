import { expect, test, _electron, type ElectronApplication } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

test('Electron 旧库升级展示待处理型号、禁止误选默认并支持本地放弃和移除绑定', async ({}, info) => {
  const userData = await mkdtemp(join(tmpdir(), 'loom-upgrade-ui-'));
  let app: ElectronApplication | undefined;
  try {
    execFileSync(
      process.execPath,
      [fileURLToPath(new URL('./fixtures/legacy-models.mjs', import.meta.url)), userData],
      { windowsHide: true },
    );
    const desktop = resolve(fileURLToPath(new URL('..', import.meta.url)));
    app = await _electron.launch({ args: [desktop, `--user-data-dir=${userData}`] });
    const page = await app.firstWindow();
    await page.getByRole('button', { name: '设置中心' }).click();
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await page.getByRole('tab', { name: '模型服务' }).click();
    await page.getByText('旧视频配置升级记录（1 项）').click();
    await expect(page.getByText(/unknown-cost-suffix/)).toBeVisible();
    await expect(page.getByRole('button', { name: '恢复查询／下载' })).toHaveCount(0);
    for (const theme of ['light', 'dark']) {
      await page.evaluate(`window.frameLoom.theme.set('${theme}')`);
      await page.emulateMedia({ colorScheme: theme as 'light' | 'dark' });
      await expect(page.locator('body')).toHaveCSS(
        'background-color',
        theme === 'dark' ? 'rgb(13, 13, 15)' : 'rgb(246, 247, 249)',
      );
      await page.setViewportSize({ width: 800, height: 800 });
      await page.screenshot({
        path: info.outputPath(`model-upgrade-${theme}.png`),
        animations: 'disabled',
      });
    }
    await page.getByRole('button', { name: '本地放弃任务' }).click();
    await page.getByRole('button', { name: '确认本地放弃' }).click();
    await expect(page.getByRole('button', { name: '移除待处理绑定' })).toBeVisible();
    await page.getByRole('button', { name: '移除待处理绑定' }).click();
    await page.getByRole('button', { name: '确认移除旧绑定' }).click();
    await expect(page.getByText('已移除绑定')).toBeVisible();
    await page.getByRole('button', { name: '编辑 升级测试' }).click();
    await expect(
      page.getByText('尚无模型。可以从渠道拉取可用模型挑选，也可以手动填写模型 ID。'),
    ).toBeVisible();
    expect(
      (await readdir(join(userData, 'data'))).filter((name) => name.includes('.before-')),
    ).toHaveLength(1);
  } finally {
    await app?.close();
    await rm(userData, { recursive: true, force: true });
  }
});
