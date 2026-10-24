import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { readTheme, writeTheme } from './preferences.js';

let directory: string;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'frame-loom-preferences-'));
});
afterEach(() => rmSync(directory, { recursive: true, force: true }));

it('文件缺失时跟随系统', () => {
  expect(readTheme(directory)).toBe('system');
});

it.each(['{', 'null', '{}', '{"version":2,"theme":"dark"}', '{"version":1,"theme":"invalid"}'])(
  '文件损坏或格式非法时跟随系统：%s',
  (content) => {
    writeFileSync(join(directory, 'preferences.json'), content);
    expect(readTheme(directory)).toBe('system');
  },
);

it('创建目录并持久化偏好，支持覆盖和重新读取', () => {
  const nested = join(directory, 'user-data');
  for (const source of ['dark', 'light', 'system'] as const) {
    writeTheme(nested, source);
    expect(readTheme(nested)).toBe(source);
    expect(JSON.parse(readFileSync(join(nested, 'preferences.json'), 'utf8'))).toEqual({
      version: 1,
      theme: source,
    });
    expect(existsSync(join(nested, 'preferences.json.tmp'))).toBe(false);
  }
});

it('替换失败向调用方报错并清理临时文件', () => {
  mkdirSync(join(directory, 'preferences.json'));
  expect(() => writeTheme(directory, 'dark')).toThrow();
  expect(existsSync(join(directory, 'preferences.json'))).toBe(true);
  expect(existsSync(join(directory, 'preferences.json.tmp'))).toBe(false);
});
