import { app, ipcMain, nativeTheme, type BrowserWindow } from 'electron';
import { ThemeSource, WindowCommand } from '@frame-loom/contracts';
import { writeTheme } from './preferences.js';
import { isTrustedSender } from './security.js';
import { updateWindowTheme } from './theme.js';

export function registerDesktopIpc(window: BrowserWindow, origin: string): void {
  const contents = window.webContents;
  ipcMain.handle('window:is-maximized', (event) => {
    if (!isTrustedSender(event, contents, origin)) throw new Error('拒绝不可信页面的窗口请求');
    return window.isMaximized();
  });
  const sendMaximized = () => contents.send('window:maximized', window.isMaximized());
  window.on('maximize', sendMaximized);
  window.on('unmaximize', sendMaximized);
  window.on('enter-full-screen', sendMaximized);
  window.on('leave-full-screen', sendMaximized);
  ipcMain.handle('theme:get', (event) => {
    if (!isTrustedSender(event, contents, origin)) throw new Error('拒绝不可信页面的主题请求');
    return nativeTheme.themeSource;
  });
  ipcMain.handle('theme:set', (event, value: unknown) => {
    if (!isTrustedSender(event, contents, origin)) throw new Error('拒绝不可信页面的主题请求');
    const source = ThemeSource.parse(value);
    // 先落盘，失败时保留当前主题，避免界面显示成功却无法持久化。
    writeTheme(app.getPath('userData'), source);
    nativeTheme.themeSource = source;
    updateWindowTheme(window);
    return source;
  });
  ipcMain.handle('window:command', (event, value: unknown) => {
    if (!isTrustedSender(event, contents, origin)) throw new Error('拒绝不可信页面的窗口请求');
    const command = WindowCommand.parse(value);
    switch (command) {
      case 'minimize':
        window.minimize();
        break;
      case 'toggle-maximize':
        if (window.isMaximized()) window.unmaximize();
        else window.maximize();
        break;
      case 'toggle-fullscreen':
        window.setFullScreen(!window.isFullScreen());
        break;
      case 'quit':
        app.quit();
        break;
      case 'close':
        window.close();
        break;
    }
  });
}
