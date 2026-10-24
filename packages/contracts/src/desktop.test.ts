import { expect, it } from 'vitest';
import { ThemeSource, WindowCommand } from './index.js';

it.each(['system', 'light', 'dark'])('接受主题 %s', (value) => {
  expect(ThemeSource.parse(value)).toBe(value);
});

it.each(['minimize', 'toggle-maximize', 'toggle-fullscreen', 'quit'])(
  '接受窗口命令 %s',
  (value) => {
    expect(WindowCommand.parse(value)).toBe(value);
  },
);

it.each([undefined, null, '', 'LIGHT', 'close', 1, {}, ['dark']])(
  '拒绝非法桌面参数 %j',
  (value) => {
    expect(ThemeSource.safeParse(value).success).toBe(false);
    expect(WindowCommand.safeParse(value).success).toBe(false);
  },
);
