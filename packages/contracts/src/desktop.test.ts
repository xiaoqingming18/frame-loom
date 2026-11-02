import { expect, it } from 'vitest';
import { ThemeSource, WindowCommand, readDesktopPreferences, DesktopPreferences } from './index.js';

it('C07 兼容读取只移除旧剧本偏好，不吞掉其他字段错误', () => {
  const preferences = {
    version: 1,
    theme: 'dark',
    projectLocation: 'E:/项目',
    projectSort: 'name',
  };
  expect(
    readDesktopPreferences({ ...preferences, scriptView: 'markdown', scriptMentions: true }),
  ).toEqual(preferences);
  expect(() => readDesktopPreferences({ ...preferences, unknown: true })).toThrow();
  expect(() => readDesktopPreferences({ ...preferences, theme: 'broken' })).toThrow();
  expect(DesktopPreferences.safeParse({ ...preferences, scriptView: 'styled' }).success).toBe(
    false,
  );
});

it.each(['system', 'light', 'dark'])('接受主题 %s', (value) => {
  expect(ThemeSource.parse(value)).toBe(value);
});

it.each(['minimize', 'toggle-maximize', 'toggle-fullscreen', 'close', 'quit'])(
  '接受窗口命令 %s',
  (value) => {
    expect(WindowCommand.parse(value)).toBe(value);
  },
);

it.each([undefined, null, '', 'LIGHT', 'CLOSE', 1, {}, ['dark']])(
  '拒绝非法桌面参数 %j',
  (value) => {
    expect(ThemeSource.safeParse(value).success).toBe(false);
    expect(WindowCommand.safeParse(value).success).toBe(false);
  },
);
