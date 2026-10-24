import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ThemeSource } from '@frame-loom/contracts';

export function readTheme(userData: string): ThemeSource {
  try {
    const value: unknown = JSON.parse(readFileSync(join(userData, 'preferences.json'), 'utf8'));
    if (!value || typeof value !== 'object' || !('version' in value) || value.version !== 1)
      return 'system';
    return ThemeSource.parse('theme' in value ? value.theme : undefined);
  } catch {
    return 'system';
  }
}

export function writeTheme(userData: string, theme: ThemeSource): void {
  mkdirSync(userData, { recursive: true });
  const file = join(userData, 'preferences.json');
  const temporary = `${file}.tmp`;
  try {
    writeFileSync(temporary, JSON.stringify({ version: 1, theme }), 'utf8');
    renameSync(temporary, file);
  } finally {
    rmSync(temporary, { force: true });
  }
}
