import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { TagColor } from '@frame-loom/contracts';

it('全部标签色都有明暗 token，徽标文字对比度至少 4.5:1', () => {
  const css = readFileSync(new URL('../renderer/src/styles/theme.css', import.meta.url), 'utf8');
  const luminance = (hex: string) => {
    const rgb = [0, 2, 4].map((offset) => {
      const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  };
  const sections = css.split('@media (prefers-color-scheme: dark)');
  for (const [index, mode] of ['light', 'dark'].entries()) {
    for (const color of TagColor.options) {
      const token = (suffix: string) => {
        const match = sections[index].match(
          new RegExp(`--tag-${color}${suffix}:\\s*#([a-fA-F0-9]{6});`),
        );
        expect(match, `${mode} ${color}${suffix}`).not.toBeNull();
        return luminance(match![1]);
      };
      const foreground = token('');
      const background = token('-bg');
      const contrast =
        (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
      expect(contrast, `${mode} ${color}`).toBeGreaterThanOrEqual(4.5);
    }
  }
});

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
