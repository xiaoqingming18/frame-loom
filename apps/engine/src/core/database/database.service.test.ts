import Database from 'better-sqlite3';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';
import { packageRoot } from '../../package-root.js';
import { EngineConfig } from '../config/config.js';
import { DatabaseService } from './database.service.js';
import { appMeta } from './app-meta.schema.js';

const directories: string[] = [];
const databases: DatabaseService[] = [];
afterEach(() => {
  for (const database of databases.splice(0)) database.onModuleDestroy();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function openDatabase() {
  const directory = mkdtempSync(join(tmpdir(), 'frame-loom-db-'));
  directories.push(directory);
  const config = new EngineConfig('a'.repeat(64), directory, []);
  const database = new DatabaseService(config);
  databases.push(database);
  return { config, database };
}

it('迁移创建 app_meta、schema 版本和迁移日志，并启用 WAL 与外键', () => {
  const { database } = openDatabase();
  expect(database.getSchemaVersion()).toBe('1');
  expect(database.db.get(sql`PRAGMA journal_mode`)).toEqual({ journal_mode: 'wal' });
  expect(database.db.get(sql`PRAGMA foreign_keys`)).toEqual({ foreign_keys: 1 });
  expect(database.db.get(sql`SELECT count(*) AS count FROM __drizzle_migrations`)).toEqual({
    count: 6,
  });
});

it('渠道预设迁移为 API 格式，旧值按拉取鉴权方式回填', () => {
  const directory = mkdtempSync(join(tmpdir(), 'frame-loom-db-'));
  directories.push(directory);
  // 只应用 0000～0003，模拟升级前的数据库。
  const source = fileURLToPath(new URL('drizzle/', packageRoot));
  const legacy = join(directory, 'legacy-drizzle');
  cpSync(source, legacy, { recursive: true });
  const journalPath = join(legacy, 'meta/_journal.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: unknown[] };
  journal.entries = journal.entries.slice(0, 4);
  writeFileSync(journalPath, JSON.stringify(journal));
  mkdirSync(join(directory, 'data'));
  const sqlite = new Database(join(directory, 'data/frame-loom.sqlite'));
  migrate(drizzle(sqlite), { migrationsFolder: legacy });
  const insert = sqlite.prepare(
    `INSERT INTO channels (id, name, preset, base_url, header_names, enabled, created_at, updated_at)
     VALUES (?, ?, ?, 'https://example.com', '[]', 1, '', '')`,
  );
  const presets = ['openai', 'anthropic', 'minimax', 'gemini', 'ark', 'openai-compatible'];
  presets.forEach((preset) => insert.run(preset, preset, preset));
  sqlite.close();
  const database = new DatabaseService(new EngineConfig('a'.repeat(64), directory, []));
  databases.push(database);
  expect(
    Object.fromEntries(
      database.db
        .all<{ id: string; api_format: string }>(sql`SELECT id, api_format FROM channels`)
        .map((row) => [row.id, row.api_format]),
    ),
  ).toEqual({
    openai: 'openai-responses',
    anthropic: 'anthropic-messages',
    minimax: 'anthropic-messages',
    gemini: 'google-generative-ai',
    ark: 'openai-completions',
    'openai-compatible': 'openai-completions',
  });
});

it('重复迁移不丢已有元数据且不重复执行，关闭后连接不可用', () => {
  const { database, config } = openDatabase();
  database.db.insert(appMeta).values({ key: 'test', value: '保留数据' }).run();
  databases.pop();
  database.onModuleDestroy();
  expect(() => database.getSchemaVersion()).toThrow();
  const reopened = new DatabaseService(config);
  databases.push(reopened);
  expect(reopened.db.select().from(appMeta).all()).toContainEqual({
    key: 'test',
    value: '保留数据',
  });
  expect(reopened.db.get(sql`SELECT count(*) AS count FROM __drizzle_migrations`)).toEqual({
    count: 6,
  });
});

it('数据库损坏时拒绝启动，关闭失败连接后仍可清理文件', () => {
  const { database, config } = openDatabase();
  databases.pop();
  database.onModuleDestroy();
  writeFileSync(join(config.dataDir, 'data/frame-loom.sqlite'), '损坏的数据库');
  expect(() => new DatabaseService(config)).toThrow();
});
