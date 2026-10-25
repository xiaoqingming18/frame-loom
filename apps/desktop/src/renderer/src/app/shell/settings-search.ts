import { z } from 'zod';

export const settingsTab = z.enum([
  'appearance',
  'engine',
  'models',
  'defaults',
  'storage',
  'about',
]);
export type SettingsTab = z.infer<typeof settingsTab>;
export const settingsSearch = z.object({ settings: settingsTab.optional().catch(undefined) });
