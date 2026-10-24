import { test, expect, _electron, type ElectronApplication } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
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
    expect(await application.evaluate(({ app }) => app.getPath('userData'))).toBe(userData);
    expect(await page.evaluate(() => {
      const globals = globalThis as unknown as Record<string, unknown>;
      return [typeof globals.require, typeof globals.process, typeof globals.ipcRenderer];
    })).toEqual([
      'undefined', 'undefined', 'undefined',
    ]);
    const enginePid = await application.evaluate(({ app }) =>
      app.getAppMetrics().find((metric) => metric.name === 'Frame Loom Engine')?.pid);
    expect(enginePid).toBeDefined();
    const closed = application.waitForEvent('close');
    await page.close();
    await closed;
    await expect.poll(() => {
      try {
        process.kill(enginePid!, 0);
        return false;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ESRCH') return true;
        throw error;
      }
    }).toBe(true);
  } finally {
    await application?.close();
    await rm(userData, { recursive: true, force: true });
  }
});
