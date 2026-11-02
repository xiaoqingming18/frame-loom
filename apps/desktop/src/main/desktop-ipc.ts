import { app, dialog, ipcMain, nativeTheme, shell, type BrowserWindow } from 'electron';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  DesktopPreferencesUpdate,
  EngineConnection,
  PickDirectoryRequest,
  ProjectRevealRequest,
  ProjectTrashRequest,
  ThemeSource,
  WindowCommand,
} from '@frame-loom/contracts';
import { readPreferences, writePreferences, writeTheme } from './preferences.js';
import { projectTarget } from './project-files.js';
import { isTrustedSender } from './security.js';
import { updateWindowTheme } from './theme.js';

export function registerDesktopIpc(
  window: BrowserWindow,
  origin: string,
  getConnection: () => Promise<unknown> = () => Promise.reject(new Error('本地服务不可用')),
): void {
  const contents = window.webContents;
  const preferences = () => {
    const value = readPreferences(app.getPath('userData'));
    return {
      projectLocation: join(app.getPath('documents'), 'Frame Loom', 'Projects'),
      projectSort: 'updated' as const,
      assetView: 'grid' as const,
      ...value,
    };
  };
  ipcMain.handle('preferences:get', (event) => {
    if (!isTrustedSender(event, contents, origin)) throw new Error('拒绝不可信页面的偏好请求');
    const value = preferences();
    if (!readPreferences(app.getPath('userData')).projectLocation)
      mkdirSync(value.projectLocation, { recursive: true });
    return value;
  });
  ipcMain.handle('preferences:set', (event, input: unknown) => {
    if (!isTrustedSender(event, contents, origin)) throw new Error('拒绝不可信页面的偏好请求');
    const update = DesktopPreferencesUpdate.parse(input);
    writePreferences(app.getPath('userData'), update);
    if (update.theme) {
      nativeTheme.themeSource = update.theme;
      updateWindowTheme(window);
    }
    return preferences();
  });
  ipcMain.handle('dialog:pick-directory', (event, input: unknown) => {
    if (!isTrustedSender(event, contents, origin)) throw new Error('拒绝不可信页面的目录请求');
    const options = PickDirectoryRequest.parse(input);
    return dialog
      .showOpenDialog(window, { ...options, properties: ['openDirectory'] })
      .then((result) => (result.canceled ? null : (result.filePaths[0] ?? null)));
  });
  for (const channel of ['project:reveal', 'project:trash'] as const) {
    ipcMain.handle(channel, (event, input: unknown) => {
      if (!isTrustedSender(event, contents, origin)) throw new Error('拒绝不可信页面的项目请求');
      const value = (
        channel === 'project:trash' ? ProjectTrashRequest : ProjectRevealRequest
      ).parse(input);
      return getConnection()
        .then((value) => EngineConnection.parse(value))
        .then(async (connection) => {
          const target = await projectTarget(value, connection);
          if (channel === 'project:trash' && value.path === undefined) {
            const response = await fetch(
              `${connection.baseUrl}/projects/${value.projectId}/release`,
              {
                method: 'POST',
                headers: { Authorization: `Bearer ${connection.token}` },
                redirect: 'error',
                signal: AbortSignal.timeout(200000),
              },
            );
            if (!response.ok) throw new Error('无法停止项目剧本任务，请稍后重试');
          }
          return target;
        })
        .then(async (target) => {
          if (channel === 'project:trash') await shell.trashItem(target);
          else shell.showItemInFolder(target);
        });
    });
  }
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
