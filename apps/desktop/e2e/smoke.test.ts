import { test, expect, _electron, type ElectronApplication } from '@playwright/test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

test('窗口显示真实 engine 健康状态，关闭后服务退出', async () => {
  const userData = await mkdtemp(join(tmpdir(), 'frame-loom-e2e-'));
  const desktop = resolve(fileURLToPath(new URL('..', import.meta.url)));
  let application: ElectronApplication | undefined;
  try {
    // shortcut: 生产 fuse 禁用主进程调试，安装包另做真实启动验证；调试协议兼容后再统一。
    application = await _electron.launch({ args: [desktop, `--user-data-dir=${userData}`] });
    const page = await application.firstWindow();
    await expect(page.getByRole('status')).toHaveText('运行正常');
    await expect(page.getByTestId('engine-version')).toHaveText(/\S+/);
    expect(new URL(page.url()).hash).toBe('#/');
    await page.goto(`${page.url().split('#')[0]}#/missing`);
    await expect(page.getByRole('heading', { name: '页面不存在' })).toBeVisible();
    await page.reload();
    expect(new URL(page.url()).hash).toBe('#/missing');
    await expect(page.getByRole('heading', { name: '页面不存在' })).toBeVisible();
    await page.getByRole('link', { name: '返回首页' }).click();
    await expect(page.getByRole('status')).toHaveText('运行正常');
    expect(await application.evaluate(({ app }) => app.getPath('userData'))).toBe(userData);
    expect(
      await page.evaluate(() => {
        const globals = globalThis as unknown as Record<string, unknown>;
        return [typeof globals.require, typeof globals.process, typeof globals.ipcRenderer];
      }),
    ).toEqual(['undefined', 'undefined', 'undefined']);
    const enginePid = await application.evaluate(
      ({ app }) => app.getAppMetrics().find((metric) => metric.name === 'Frame Loom Engine')?.pid,
    );
    expect(enginePid).toBeDefined();
    const closed = application.waitForEvent('close');
    await page.close();
    await closed;
    await expect
      .poll(() => {
        try {
          process.kill(enginePid!, 0);
          return false;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ESRCH') return true;
          throw error;
        }
      })
      .toBe(true);
  } finally {
    await application?.close();
    await rm(userData, { recursive: true, force: true });
  }
});

test('损坏偏好可启动，主题同步原生窗口并在重启后保持', async () => {
  const userData = await mkdtemp(join(tmpdir(), 'frame-loom-theme-e2e-'));
  const desktop = resolve(fileURLToPath(new URL('..', import.meta.url)));
  let application: ElectronApplication | undefined;
  try {
    await writeFile(join(userData, 'preferences.json'), '{broken');
    application = await _electron.launch({ args: [desktop, `--user-data-dir=${userData}`] });
    let page = await application.firstWindow();
    // Playwright 默认模拟明亮模式，清除模拟后才能验证 Electron 的真实主题。
    await page.emulateMedia({ colorScheme: null });
    await expect(page.getByRole('status')).toHaveText('运行正常');
    expect(await page.evaluate<unknown>('window.frameLoom.theme.get()')).toBe('system');
    for (const [source, background] of [
      ['dark', 'rgb(13, 13, 15)'],
      ['light', 'rgb(246, 247, 249)'],
    ] as const) {
      await page.evaluate<unknown>(`window.frameLoom.theme.set('${source}')`);
      await expect(page.locator('body')).toHaveCSS('background-color', background);
      expect(
        await page.evaluate<boolean>("matchMedia('(prefers-color-scheme: dark)').matches"),
      ).toBe(source === 'dark');
      expect(
        await application.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0].getBackgroundColor(),
        ),
      ).toBe(source === 'dark' ? '#0D0D0F' : '#F6F7F9');
    }
    await expect(page.evaluate<unknown>("window.frameLoom.theme.set('invalid')")).rejects.toThrow();
    expect(await page.evaluate<unknown>('window.frameLoom.theme.get()')).toBe('light');
    await page.evaluate<unknown>("window.frameLoom.theme.set('dark')");
    expect(JSON.parse(await readFile(join(userData, 'preferences.json'), 'utf8'))).toEqual({
      version: 1,
      theme: 'dark',
    });
    await application.close();
    application = await _electron.launch({ args: [desktop, `--user-data-dir=${userData}`] });
    page = await application.firstWindow();
    await page.emulateMedia({ colorScheme: null });
    await expect(page.getByRole('status')).toHaveText('运行正常');
    expect(await page.evaluate<unknown>('window.frameLoom.theme.get()')).toBe('dark');
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(13, 13, 15)');
    await page.evaluate<unknown>("window.frameLoom.theme.set('system')");
    expect(await page.evaluate<boolean>("matchMedia('(prefers-color-scheme: dark)').matches")).toBe(
      await application.evaluate(({ nativeTheme }) => nativeTheme.shouldUseDarkColors),
    );
    const closed = application.waitForEvent('close');
    await page.evaluate<unknown>("window.frameLoom.window.command('quit')");
    await closed;
  } finally {
    await application?.close();
    await rm(userData, { recursive: true, force: true });
  }
});
