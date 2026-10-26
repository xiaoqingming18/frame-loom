import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DesktopPreferences,
  DesktopPreferencesUpdate,
  type ThemeSource,
} from '@frame-loom/contracts';

export function readPreferences(userData: string): DesktopPreferences {
  try {
    return DesktopPreferences.parse(
      JSON.parse(readFileSync(join(userData, 'preferences.json'), 'utf8')),
    );
  } catch {
    return { version: 1, theme: 'system' };
  }
}

export function readTheme(userData: string): ThemeSource {
  return readPreferences(userData).theme;
}

export function writeTheme(userData: string, theme: ThemeSource): void {
  writePreferences(userData, { theme });
}

export function writePreferences(
  userData: string,
  update: DesktopPreferencesUpdate,
): DesktopPreferences {
  const value = DesktopPreferences.parse({
    ...readPreferences(userData),
    ...DesktopPreferencesUpdate.parse(update),
  });
  mkdirSync(userData, { recursive: true });
  const file = join(userData, 'preferences.json');
  const temporary = `${file}.tmp`;
  try {
    writeFileSync(temporary, JSON.stringify(value), 'utf8');
    renameSync(temporary, file);
  } finally {
    rmSync(temporary, { force: true });
  }
  return value;
}
