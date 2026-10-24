import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';
import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (event: IpcMainInvokeEvent, value?: unknown) => unknown>(),
  quit: vi.fn(),
  theme: { themeSource: 'system', shouldUseDarkColors: false },
  writeTheme: vi.fn(),
}));
vi.mock('electron', () => ({
  app: { quit: mocks.quit, getPath: () => 'user-data' },
  nativeTheme: mocks.theme,
  ipcMain: {
    handle: (channel: string, handler: (event: IpcMainInvokeEvent, value?: unknown) => unknown) =>
      mocks.handlers.set(channel, handler),
  },
}));
vi.mock('./preferences.js', () => ({ writeTheme: mocks.writeTheme }));

import { registerDesktopIpc } from './desktop-ipc.js';
import { APP_ORIGIN } from './security.js';

const frame = { url: `${APP_ORIGIN}/` };
const contents = { mainFrame: frame, send: vi.fn() };
const listeners = new Map<string, () => void>();
const window = {
  webContents: contents,
  setBackgroundColor: vi.fn(),
  on: vi.fn((name: string, callback: () => void) => {
    listeners.set(name, callback);
  }),
  close: vi.fn(),
  minimize: vi.fn(),
  maximize: vi.fn(),
  unmaximize: vi.fn(),
  isMaximized: vi.fn(() => false),
  isFullScreen: vi.fn(() => false),
  setFullScreen: vi.fn(),
};
const event = { sender: contents, senderFrame: frame } as unknown as IpcMainInvokeEvent;
const invoke = (channel: string, value?: unknown, caller = event) =>
  mocks.handlers.get(channel)!(caller, value);

beforeEach(() => {
  vi.resetAllMocks();
  mocks.theme.themeSource = 'system';
  mocks.theme.shouldUseDarkColors = false;
  registerDesktopIpc(window as unknown as BrowserWindow, APP_ORIGIN);
});

it.each(['theme:get', 'theme:set', 'window:command', 'window:is-maximized'])(
  '%s 拒绝不可信调用方',
  (channel) => {
    for (const caller of [
      { ...event, sender: {} },
      { ...event, senderFrame: { url: `${APP_ORIGIN}/` } },
      { ...event, senderFrame: null },
    ]) {
      expect(() => invoke(channel, 'dark', caller as IpcMainInvokeEvent)).toThrow('拒绝不可信');
    }
    expect(mocks.writeTheme).not.toHaveBeenCalled();
    expect(mocks.quit).not.toHaveBeenCalled();
    expect(window.close).not.toHaveBeenCalled();
  },
);

it.each([undefined, null, '', {}, 'invalid'])('拒绝非法主题和窗口命令 %j', (value) => {
  expect(() => invoke('theme:set', value)).toThrow();
  expect(() => invoke('window:command', value)).toThrow();
  expect(mocks.writeTheme).not.toHaveBeenCalled();
  expect(mocks.quit).not.toHaveBeenCalled();
});

it('读取主题；先保存偏好，再更新原生主题与窗口颜色', () => {
  expect(invoke('theme:get')).toBe('system');
  mocks.writeTheme.mockImplementation(() => expect(mocks.theme.themeSource).toBe('system'));
  mocks.theme.shouldUseDarkColors = true;
  expect(invoke('theme:set', 'dark')).toBe('dark');
  expect(mocks.writeTheme).toHaveBeenCalledWith('user-data', 'dark');
  expect(mocks.theme.themeSource).toBe('dark');
  expect(window.setBackgroundColor).toHaveBeenCalledWith('#0d0d0f');
});

it('保存失败时保留当前主题，不更新窗口', () => {
  mocks.writeTheme.mockImplementation(() => {
    throw new Error('写入失败');
  });
  expect(() => invoke('theme:set', 'light')).toThrow('写入失败');
  expect(mocks.theme.themeSource).toBe('system');
  expect(window.setBackgroundColor).not.toHaveBeenCalled();
});

it('执行最小化、最大化／还原、全屏切换与正常退出', () => {
  invoke('window:command', 'minimize');
  expect(window.minimize).toHaveBeenCalledOnce();
  invoke('window:command', 'toggle-maximize');
  expect(window.maximize).toHaveBeenCalledOnce();
  window.isMaximized.mockReturnValue(true);
  invoke('window:command', 'toggle-maximize');
  expect(window.unmaximize).toHaveBeenCalledOnce();
  invoke('window:command', 'toggle-fullscreen');
  expect(window.setFullScreen).toHaveBeenLastCalledWith(true);
  window.isFullScreen.mockReturnValue(true);
  invoke('window:command', 'toggle-fullscreen');
  expect(window.setFullScreen).toHaveBeenLastCalledWith(false);
  invoke('window:command', 'quit');
  expect(mocks.quit).toHaveBeenCalledOnce();
  invoke('window:command', 'close');
  expect(window.close).toHaveBeenCalledOnce();
});

it('查询真实最大化状态，并在系统窗口变化时通知 renderer', () => {
  expect(invoke('window:is-maximized')).toBe(false);
  window.isMaximized.mockReturnValue(true);
  expect(invoke('window:is-maximized')).toBe(true);
  for (const name of ['maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen']) {
    window.isMaximized.mockReturnValue(name === 'maximize');
    listeners.get(name)!();
    expect(contents.send).toHaveBeenLastCalledWith('window:maximized', name === 'maximize');
  }
});
