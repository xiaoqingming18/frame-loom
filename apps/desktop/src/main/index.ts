import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeTheme,
  net,
  protocol,
  safeStorage,
  utilityProcess,
} from 'electron';
import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { engineEntry, manageEngine } from './engine.js';
import {
  APP_ORIGIN,
  PRODUCTION_CSP,
  isTrustedSender,
  isTrustedUrl,
  rendererFile,
} from './security.js';
import { registerDesktopIpc } from './desktop-ipc.js';
import { readTheme } from './preferences.js';
import { WINDOW_BACKGROUNDS, updateWindowTheme } from './theme.js';
import { loadSecretKey } from './secret-key.js';
import { serveMedia } from './media-protocol.js';

const directory = dirname(fileURLToPath(import.meta.url));
app.setName('Frame Loom');
const hasLock = app.requestSingleInstanceLock();
let window: BrowserWindow | undefined;
let engine: ReturnType<typeof manageEngine> | undefined;
let quitting = false;
let stopped = false;

if (!hasLock) {
  app.quit();
} else {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'frame-media',
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
    },
    {
      scheme: 'app',
      privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
    },
  ]);

  app.on('second-instance', () => {
    if (window?.isMinimized()) window.restore();
    window?.focus();
  });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', (event) => {
    if (stopped) return;
    event.preventDefault();
    if (quitting) return;
    quitting = true;
    void (engine?.stop() ?? Promise.resolve()).finally(() => {
      stopped = true;
      app.quit();
    });
  });

  // Electron 等主模块加载后才触发 ready，顶层 await whenReady 会互相等待。
  void app.whenReady().then(start);
}

async function start(): Promise<void> {
  try {
    const devUrl = !app.isPackaged ? process.env.ELECTRON_RENDERER_URL : undefined;
    const origin = devUrl ? new URL(devUrl).origin : APP_ORIGIN;
    protocol.handle('frame-media', (request) =>
      serveMedia(join(app.getPath('userData'), 'media'), request),
    );
    protocol.handle('app', async (request) => {
      const file = rendererFile(join(directory, '../renderer'), request.url);
      if (request.method !== 'GET' || !file) return new Response(null, { status: 403 });
      try {
        const response = await net.fetch(pathToFileURL(file).href);
        return new Response(response.body, {
          status: response.status,
          headers: {
            'Content-Type': response.headers.get('Content-Type') ?? 'application/octet-stream',
            'Content-Security-Policy': PRODUCTION_CSP,
          },
        });
      } catch {
        return new Response(null, { status: 404 });
      }
    });

    let startupError: unknown;
    let secretWarning: string | undefined;
    try {
      const token = randomBytes(32).toString('hex');
      let secretKey = '';
      try {
        const result = await loadSecretKey(app.getPath('userData'), safeStorage);
        secretKey = result.key;
        secretWarning = result.warning;
      } catch {
        secretWarning =
          '主密钥无法读取或保存，当前无法使用已保存的凭据。请检查数据目录权限后重启应用。';
      }
      const child = utilityProcess.fork(
        engineEntry(app.isPackaged, app.getAppPath(), process.resourcesPath),
        [],
        {
          serviceName: 'Frame Loom Engine',
          stdio: 'pipe',
          env: {
            ...process.env,
            FRAME_LOOM_TOKEN: token,
            FRAME_LOOM_SECRET_KEY: secretKey,
            FRAME_LOOM_DATA_DIR: app.getPath('userData'),
            FRAME_LOOM_ALLOWED_ORIGINS: JSON.stringify([origin]),
          },
        },
      );
      child.stderr?.on('data', (chunk: Buffer) => process.stderr.write(chunk));
      // 令牌只通过环境和可信 IPC 传递，不写入日志。
      engine = manageEngine(child, token, (code) => {
        console.info(`engine 已退出，退出码 ${code}`);
        // 通知页面而不是重载，保留画布等未保存的编辑状态。
        if (
          !quitting &&
          window &&
          !window.isDestroyed() &&
          isTrustedUrl(window.webContents.getURL(), origin)
        )
          window.webContents.send('engine:exited', code);
      });
    } catch (error) {
      startupError = error;
      console.error('本地服务启动失败：', error);
    }

    nativeTheme.themeSource = readTheme(app.getPath('userData'));
    window = new BrowserWindow({
      title: 'Frame Loom',
      width: 1120,
      height: 760,
      minWidth: 720,
      minHeight: 560,
      backgroundColor: WINDOW_BACKGROUNDS[nativeTheme.shouldUseDarkColors ? 'dark' : 'light'],
      frame: false,
      autoHideMenuBar: true,
      ...(!app.isPackaged ? { icon: join(directory, '../../resources/icon.png') } : {}),
      show: false,
      webPreferences: {
        preload: join(directory, '../preload/index.cjs'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
      },
    });
    const contents = window.webContents;
    // 默认菜单的重载、页面缩放等快捷键会丢失画布未保存的内容或与画布快捷键冲突。
    Menu.setApplicationMenu(null);
    void contents.setVisualZoomLevelLimits(1, 1);
    if (!app.isPackaged)
      contents.on('before-input-event', (_event, input) => {
        if (
          input.type === 'keyDown' &&
          (input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i'))
        )
          contents.toggleDevTools();
      });
    registerDesktopIpc(window, origin);
    nativeTheme.on('updated', () => {
      if (window && !window.isDestroyed()) updateWindowTheme(window);
    });
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    contents.on('will-navigate', (event, url) => {
      if (!isTrustedUrl(url, origin)) event.preventDefault();
    });
    contents.on('will-redirect', (event, url) => {
      if (!isTrustedUrl(url, origin)) event.preventDefault();
    });
    contents.on('will-attach-webview', (event) => event.preventDefault());
    contents.session.setPermissionRequestHandler((_contents, _permission, callback) =>
      callback(false),
    );
    contents.session.setPermissionCheckHandler(() => false);
    ipcMain.handle('engine:connection', async (event) => {
      if (!isTrustedSender(event, contents, origin)) throw new Error('拒绝不可信页面的连接请求');
      if (!engine) throw new Error('本地服务启动失败，请重新启动应用', { cause: startupError });
      return engine.getConnection();
    });
    window.once('ready-to-show', () => window?.show());
    await window.loadURL(devUrl ?? `${APP_ORIGIN}/`);
    if (secretWarning) {
      await dialog.showMessageBox(window, {
        type: 'warning',
        title: '密钥安全存储',
        message: secretWarning,
      });
    }
  } catch (error) {
    console.error('桌面窗口启动失败：', error);
    app.quit();
  }
}
