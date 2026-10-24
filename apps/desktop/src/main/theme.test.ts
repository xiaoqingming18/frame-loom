import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ nativeTheme: {} }));
import { WINDOW_BACKGROUNDS } from './theme.js';

it('主进程窗口背景和 CSS 明暗 token 一致', () => {
  const css = readFileSync(new URL('../renderer/src/styles/theme.css', import.meta.url), 'utf8');
  const sections = css.split('@media (prefers-color-scheme: dark)');
  for (const [index, mode] of (['light', 'dark'] as const).entries()) {
    const section = sections[index];
    expect(section.match(/--background:\s*([^;]+);/)?.[1]).toBe(WINDOW_BACKGROUNDS[mode]);
  }
});
