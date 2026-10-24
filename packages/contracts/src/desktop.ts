import { z } from 'zod';

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
