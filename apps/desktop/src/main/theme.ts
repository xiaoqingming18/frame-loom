import { nativeTheme, type BrowserWindow } from 'electron';

export const TITLE_BAR_COLORS = {
  light: { color: '#f6f7f9', symbolColor: '#8c8c8c' },
  dark: { color: '#0d0d0f', symbolColor: '#a1a1aa' },
};

export function updateWindowTheme(window: BrowserWindow): void {
  const colors = TITLE_BAR_COLORS[nativeTheme.shouldUseDarkColors ? 'dark' : 'light'];
  window.setBackgroundColor(colors.color);
  window.setTitleBarOverlay(colors);
}
