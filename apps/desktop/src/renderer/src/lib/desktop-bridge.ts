import { ThemeSource, type WindowCommand } from '@frame-loom/contracts';
import { z } from 'zod';

export function getEngineConnection(): Promise<unknown> {
  return window.frameLoom.getEngineConnection();
}

export function onEngineExited(callback: (code: number | null) => void): () => void {
  return window.frameLoom.onEngineExited((value) =>
    callback(z.number().int().nullable().parse(value)),
  );
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

export async function getWindowMaximized(): Promise<boolean> {
  return z.boolean().parse(await window.frameLoom.window.isMaximized());
}

export function onWindowMaximizedChanged(callback: (maximized: boolean) => void): () => void {
  return window.frameLoom.window.onMaximizedChanged((value) => callback(z.boolean().parse(value)));
}
