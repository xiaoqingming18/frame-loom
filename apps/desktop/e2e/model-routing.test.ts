import { expect, test, _electron, type ElectronApplication } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

test('逻辑模型、帮助及收费确认在明暗和窄窗口下可用，保存与取消测试不发起生成', async ({}, info) => {
  const userData = await mkdtemp(join(tmpdir(), 'loom-routing-ui-'));
  const desktop = resolve(fileURLToPath(new URL('..', import.meta.url)));
  let app: ElectronApplication | undefined;
  try {
    app = await _electron.launch({ args: [desktop, `--user-data-dir=${userData}`] });
    const page = await app.firstWindow();
    await page.emulateMedia({ colorScheme: null });
    const errors: string[] = [];
    const generations: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().endsWith('/generation-jobs'))
        generations.push(request.url());
    });
    await page.getByRole('button', { name: '设置中心' }).click();
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await page.getByRole('tab', { name: '模型服务' }).click();
    await page.getByRole('button', { name: '添加渠道' }).click();
    await page.getByLabel('渠道名称').fill('媒体渠道');
    await page.getByLabel('接口地址', { exact: true }).fill('http://127.0.0.1:1/v1');
    await page.getByLabel('API 密钥').fill('local-test-only');
    await page.getByRole('button', { name: '添加模型' }).click();
    await page.getByLabel('逻辑模型').selectOption('seedance-2.5');
    await expect(page.getByLabel('接入', { exact: true })).toHaveValue('ark-video-tasks');
    await expect(page.getByLabel('模型类别')).toHaveCount(0);
    await expect(page.getByLabel('能力档案')).toHaveCount(0);
    await page.getByLabel('模型 ID').fill('custom-seedance');
    await page.getByLabel('显示名称').fill('中文视频');
    await page.getByRole('button', { name: '检查草稿配置' }).click();
    await expect(page.getByText(/草稿格式检查通过/)).toBeVisible();
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await page.getByRole('button', { name: '编辑 媒体渠道' }).click();
    for (const theme of ['light', 'dark']) {
      await page.evaluate(`window.frameLoom.theme.set('${theme}')`);
      await page.setViewportSize({ width: 800, height: 800 });
      const help = page.getByRole('button', { name: '模型与接入帮助' });
      await help.scrollIntoViewIfNeeded();
      await help.hover();
      await expect(page.getByText(/模型定义自动决定类别/)).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByText(/模型定义自动决定类别/)).not.toBeVisible();
      await page.getByLabel('显示名称').focus();
      await help.focus();
      await expect(page.getByText(/模型定义自动决定类别/)).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByText(/模型定义自动决定类别/)).not.toBeVisible();
      await help.click();
      await expect(page.getByText(/模型定义自动决定类别/)).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByText(/模型定义自动决定类别/)).not.toBeVisible();
      await page.getByRole('button', { name: '实际媒体调用测试' }).click();
      await expect(page.getByRole('dialog', { name: '实际媒体调用测试' })).toBeVisible();
      await expect(page.getByText(/将使用已保存的配置/)).toBeVisible();
      await expect
        .poll(() =>
          page.getByRole('dialog', { name: '实际媒体调用测试' }).evaluate((element) => {
            const box = element.getBoundingClientRect();
            return element.contains(document.elementFromPoint(box.x + 20, box.y + 20));
          }),
        )
        .toBe(true);
      await page.screenshot({
        path: info.outputPath(`media-test-${theme}.png`),
        animations: 'disabled',
      });
      const confirm = page.getByRole('button', { name: '确认调用并承担可能费用' });
      await confirm.scrollIntoViewIfNeeded();
      await expect(confirm).toBeInViewport();
      await page.screenshot({
        path: info.outputPath(`media-test-actions-${theme}.png`),
        animations: 'disabled',
      });
      await page.getByRole('button', { name: '取消', exact: true }).last().click();
      const panel = page.getByRole('tabpanel', { name: '模型服务' });
      expect(await panel.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
        true,
      );
      await page.screenshot({ path: info.outputPath(`media-routing-${theme}.png`) });
    }
    await page.getByLabel('显示名称').fill('丢弃草稿');
    await expect(page.getByRole('button', { name: '实际媒体调用测试' })).toBeDisabled();
    await page.getByRole('button', { name: '取消', exact: true }).click();
    await page.getByRole('button', { name: '编辑 媒体渠道' }).click();
    await expect(page.getByLabel('显示名称')).toHaveValue('中文视频');
    expect(generations).toEqual([]);
    expect(errors).toEqual([]);
  } finally {
    await app?.close();
    await rm(userData, { recursive: true, force: true });
  }
});
