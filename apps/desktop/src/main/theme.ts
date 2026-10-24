import { nativeTheme, type BrowserWindow } from 'electron';

export const WINDOW_BACKGROUNDS = {
  light: '#f6f7f9',
  dark: '#0d0d0f',
};

export function updateWindowTheme(window: BrowserWindow): void {
  window.setBackgroundColor(WINDOW_BACKGROUNDS[nativeTheme.shouldUseDarkColors ? 'dark' : 'light']);
}
