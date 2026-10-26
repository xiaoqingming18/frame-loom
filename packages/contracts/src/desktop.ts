import { z } from 'zod';
import { AssetPath, ProjectId } from './projects.js';

export const ThemeSource = z.enum(['system', 'light', 'dark']);
export type ThemeSource = z.infer<typeof ThemeSource>;

export const WindowCommand = z.enum([
  'minimize',
  'toggle-maximize',
  'toggle-fullscreen',
  'close',
  'quit',
]);
export type WindowCommand = z.infer<typeof WindowCommand>;

export const ProjectSort = z.enum(['updated', 'created', 'name']);
export type ProjectSort = z.infer<typeof ProjectSort>;
export const AssetView = z.enum(['list', 'grid']);
export type AssetView = z.infer<typeof AssetView>;
export const DesktopPreferences = z.strictObject({
  version: z.literal(1),
  theme: ThemeSource,
  projectLocation: z.string().min(1).max(4096).optional(),
  projectSort: ProjectSort.optional(),
  assetView: AssetView.optional(),
});
export type DesktopPreferences = z.infer<typeof DesktopPreferences>;
export const DesktopPreferencesUpdate = DesktopPreferences.omit({ version: true }).partial();
export type DesktopPreferencesUpdate = z.infer<typeof DesktopPreferencesUpdate>;
export const PickDirectoryRequest = z.strictObject({
  defaultPath: z.string().min(1).max(4096).optional(),
});
export type PickDirectoryRequest = z.infer<typeof PickDirectoryRequest>;
export const ProjectRevealRequest = z.strictObject({
  projectId: ProjectId,
  path: AssetPath.optional(),
});
export type ProjectRevealRequest = z.infer<typeof ProjectRevealRequest>;
export const ProjectTrashRequest = ProjectRevealRequest;
export type ProjectTrashRequest = z.infer<typeof ProjectTrashRequest>;
