import {
  DesktopPreferences,
  DesktopPreferencesUpdate,
  PickDirectoryRequest,
  ProjectRevealRequest,
  ProjectTrashRequest,
  ThemeSource,
  type WindowCommand,
} from '@frame-loom/contracts';
import { z } from 'zod';

export async function getPreferences(): Promise<DesktopPreferences> {
  return DesktopPreferences.parse(await window.frameLoom.preferences.get());
}
export async function setPreferences(value: DesktopPreferencesUpdate): Promise<DesktopPreferences> {
  return DesktopPreferences.parse(
    await window.frameLoom.preferences.set(DesktopPreferencesUpdate.parse(value)),
  );
}
export async function pickDirectory(value: PickDirectoryRequest = {}): Promise<string | null> {
  return z
    .string()
    .min(1)
    .nullable()
    .parse(await window.frameLoom.pickDirectory(PickDirectoryRequest.parse(value)));
}
export function revealProject(value: ProjectRevealRequest): Promise<void> {
  return window.frameLoom.project.reveal(ProjectRevealRequest.parse(value));
}
export function trashProject(value: ProjectTrashRequest): Promise<void> {
  return window.frameLoom.project.trash(ProjectTrashRequest.parse(value));
}

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
