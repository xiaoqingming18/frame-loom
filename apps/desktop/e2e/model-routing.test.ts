import { expect, test, _electron, type ElectronApplication } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

test('媒体模板、路径预览和中文编辑在明暗及窄窗口下可用，保存不发起生成', async ({}, info) => {
  const userData = await mkdtemp(join(tmpdir(), 'loom-routing-ui-'));
  const desktop = resolve(fileURLToPath(new URL('..', import.meta.url)));
  let app: ElectronApplication | undefined;
  try {
    app = await _electron.launch({ args: [desktop, `--user-data-dir=${userData}`] });
    const page = await app.firstWindow();
    await page.emulateMedia({ colorScheme: null });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.getByRole('button', { name: '设置中心' }).click();
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await page.getByRole('tab', { name: '模型服务' }).click();
    await page.getByRole('button', { name: '添加渠道' }).click();
    await page.getByLabel('渠道名称').fill('跨域媒体渠道');
    await page.getByLabel('接口地址').fill('http://127.0.0.1:1/v1');
    await page.getByLabel('API 密钥').fill('local-test-only');
    await page.getByRole('button', { name: '添加模型' }).click();
    await page.getByLabel('模型 ID').fill('seedance-2.5-token');
    await page.getByLabel('模型类别').selectOption('video');
    await page.getByLabel('调用协议', { exact: true }).selectOption('fastaitoken-video');
    await page.getByLabel('接入模板').selectOption('fastaitoken-video');
    await expect(page.getByLabel('模型服务地址（留空继承渠道）')).toHaveValue('');
    await page.getByRole('button', { name: '应用模板并替换接入设置' }).click();
    await page.getByLabel('模型服务地址（留空继承渠道）').fill('http://127.0.0.1:1/media');
    await page.getByText('高级：操作路径和有效地址', { exact: true }).click();
    await page.getByLabel('submit 相对路径').fill('v1/videos/generations');
    await expect(
      page.getByText('http://127.0.0.1:1/media/v1/videos/generations', { exact: true }),
    ).toBeVisible();
    await page.getByLabel('显示名称').focus();
    await page.keyboard.insertText('中文视频');
    await page.keyboard.press('Tab');
    await expect(page.getByLabel('显示名称')).toHaveValue('中文视频');
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await page.getByRole('button', { name: '编辑 跨域媒体渠道' }).click();
    await expect(page.getByLabel('模型服务地址（留空继承渠道）')).toHaveValue(
      'http://127.0.0.1:1/media',
    );
    await expect(page.getByText(/精确型号档案/)).toBeVisible();
    for (const theme of ['light', 'dark']) {
      await page.evaluate(`window.frameLoom.theme.set('${theme}')`);
      await page.setViewportSize({ width: 800, height: 800 });
      await page.getByText('高级：操作路径和有效地址', { exact: true }).click();
      await page.getByLabel('submit 相对路径').scrollIntoViewIfNeeded();
      await expect(
        page.getByText('http://127.0.0.1:1/media/v1/videos/generations', { exact: true }),
      ).toBeVisible();
      await page.screenshot({ path: info.outputPath(`media-routing-${theme}.png`) });
      const panel = page.getByRole('tabpanel', { name: '模型服务' });
      expect(await panel.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
        true,
      );
      await page.getByText('高级：操作路径和有效地址', { exact: true }).click();
    }
    await page.getByLabel('模型服务地址（留空继承渠道）').fill('http://discarded.test');
    await page.getByRole('button', { name: '取消', exact: true }).click();
    await page.getByRole('button', { name: '编辑 跨域媒体渠道' }).click();
    await expect(page.getByLabel('模型服务地址（留空继承渠道）')).toHaveValue(
      'http://127.0.0.1:1/media',
    );
    await page.getByText('高级：操作路径和有效地址', { exact: true }).click();
    await page.getByLabel('submit 相对路径').fill('../admin');
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await app?.close();
    await rm(userData, { recursive: true, force: true });
  }
});
