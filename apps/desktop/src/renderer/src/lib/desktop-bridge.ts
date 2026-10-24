import { ThemeSource, type WindowCommand } from '@frame-loom/contracts';

export function getEngineConnection(): Promise<unknown> {
  return window.frameLoom.getEngineConnection();
}

export async function getTheme(): Promise<ThemeSource> {
  return ThemeSource.parse(await window.frameLoom.theme.get());
}

export async function setTheme(source: ThemeSource): Promise<ThemeSource> {
  return ThemeSource.parse(await window.frameLoom.theme.set(source));
}

export function commandWindow(name: WindowCommand): Promise<void> {
  return window.frameLoom.window.command(name);
}
