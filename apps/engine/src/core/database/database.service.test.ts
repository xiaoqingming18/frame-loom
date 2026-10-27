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
  expect(database.getSchemaVersion()).toBe('6');
  expect(database.db.get(sql`PRAGMA journal_mode`)).toEqual({ journal_mode: 'wal' });
  expect(database.db.get(sql`PRAGMA foreign_keys`)).toEqual({ foreign_keys: 1 });
  expect(database.db.get(sql`SELECT count(*) AS count FROM __drizzle_migrations`)).toEqual({
    count: 11,
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
    count: 11,
  });
});

it('从 0005 升级删除旧画布表，保留任务并新增项目注册表与视图键', () => {
  const directory = mkdtempSync(join(tmpdir(), 'frame-loom-db-'));
  directories.push(directory);
  const legacy = join(directory, 'legacy-drizzle');
  cpSync(fileURLToPath(new URL('drizzle/', packageRoot)), legacy, { recursive: true });
  const journalPath = join(legacy, 'meta/_journal.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: unknown[] };
  journal.entries = journal.entries.slice(0, 6);
  writeFileSync(journalPath, JSON.stringify(journal));
  mkdirSync(join(directory, 'data'));
  const sqlite = new Database(join(directory, 'data/frame-loom.sqlite'));
  migrate(drizzle(sqlite), { migrationsFolder: legacy });
  sqlite.exec(`INSERT INTO canvas_documents VALUES ('lab', '画布测试', 1, 1, '{}', NULL, '', '')`);
  sqlite.exec(`INSERT INTO generation_jobs (id,kind,channel_model_id,profile_id,profile_json,status,request_json,outputs_json,source,created_at,updated_at,deadline_at)
    VALUES ('old-job','image','model','profile','{}','succeeded','{}','[]','canvas','','','')`);
  sqlite.close();
  const database = new DatabaseService(new EngineConfig('a'.repeat(64), directory, []));
  databases.push(database);
  expect(database.getSchemaVersion()).toBe('6');
  expect(
    database.db.get(sql`SELECT staged_outputs_json FROM generation_jobs WHERE id = 'old-job'`),
  ).toEqual({ staged_outputs_json: '[]' });
  expect(
    database.db.get(
      sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'canvas_documents'`,
    ),
  ).toBeUndefined();
  expect(
    database.db.all<{ name: string; notnull: number }>(sql`PRAGMA table_info(generation_jobs)`),
  ).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ name: 'project_id', notnull: 0 }),
      expect.objectContaining({ name: 'page_id', notnull: 0 }),
    ]),
  );
  expect(database.db.all<{ name: string; pk: number }>(sql`PRAGMA table_info(page_views)`)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ name: 'project_id', pk: 1 }),
      expect.objectContaining({ name: 'page_id', pk: 2 }),
    ]),
  );
});

it('数据库损坏时拒绝启动，关闭失败连接后仍可清理文件', () => {
  const { database, config } = openDatabase();
  databases.pop();
  database.onModuleDestroy();
  writeFileSync(join(config.dataDir, 'data/frame-loom.sqlite'), '损坏的数据库');
  expect(() => new DatabaseService(config)).toThrow();
});

it('0008 旧库升级保留地址和历史任务，失败迁移整批回滚且备份可恢复', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'frame-loom-upgrade-'));
  directories.push(directory);
  const source = fileURLToPath(new URL('drizzle/', packageRoot));
  const legacy = join(directory, 'legacy-drizzle');
  cpSync(source, legacy, { recursive: true });
  const journalPath = join(legacy, 'meta/_journal.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: unknown[] };
  writeFileSync(journalPath, JSON.stringify({ ...journal, entries: journal.entries.slice(0, 9) }));
  mkdirSync(join(directory, 'data'));
  const path = join(directory, 'data/frame-loom.sqlite');
  const sqlite = new Database(path);
  try {
    migrate(drizzle(sqlite), { migrationsFolder: legacy });
    sqlite.exec(`INSERT INTO channels (id,name,api_format,base_url,header_names,enabled,created_at,updated_at)
      VALUES ('channel','旧渠道','openai-completions','https://example.test/v1','[]',1,'','');
      INSERT INTO channel_models (id,channel_id,upstream_model_id,display_name,kind,protocol,overrides_json,enabled)
      VALUES ('model','channel','MiniMax-H3','H3','video','minimax-video-v2','{}',1);
      INSERT INTO generation_jobs (id,kind,channel_model_id,profile_id,profile_json,status,request_json,outputs_json,source,created_at,updated_at,deadline_at)
      VALUES ('old-job','video','model','profile','{}','failed','{}','[]','canvas','','','');`);
    const backup = join(directory, 'backup.sqlite');
    await sqlite.backup(backup);
    const failing = join(directory, 'failing-drizzle');
    cpSync(source, failing, { recursive: true });
    const migration = join(failing, '0010_generation_recovery.sql');
    writeFileSync(
      migration,
      readFileSync(migration, 'utf8') +
        '\n--> statement-breakpoint\nINSERT INTO missing_table VALUES (1);',
    );
    const before = sqlite.prepare('SELECT * FROM generation_jobs').all();
    expect(() => migrate(drizzle(sqlite), { migrationsFolder: failing })).toThrow();
    expect(sqlite.prepare('SELECT * FROM generation_jobs').all()).toEqual(before);
    expect(sqlite.prepare('SELECT count(*) AS count FROM __drizzle_migrations').get()).toEqual({
      count: 9,
    });
    expect(sqlite.prepare('PRAGMA table_info(channel_models)').all()).not.toContainEqual(
      expect.objectContaining({ name: 'connection_json' }),
    );
    expect(sqlite.prepare('PRAGMA table_info(generation_jobs)').all()).not.toContainEqual(
      expect.objectContaining({ name: 'snapshot_json' }),
    );
    const restored = new Database(backup);
    try {
      expect(restored.prepare('SELECT * FROM generation_jobs').all()).toEqual(before);
    } finally {
      restored.close();
    }
  } finally {
    sqlite.close();
  }
  const database = new DatabaseService(new EngineConfig('a'.repeat(64), directory, []));
  databases.push(database);
  expect(database.getSchemaVersion()).toBe('6');
  expect(database.db.get(sql`SELECT base_url FROM channels WHERE id = 'channel'`)).toEqual({
    base_url: 'https://example.test/v1',
  });
  expect(
    database.db.get(sql`SELECT connection_json FROM channel_models WHERE id = 'model'`),
  ).toEqual({ connection_json: '{}' });
  expect(
    database.db.get(
      sql`SELECT status, snapshot_json, diagnostic_json FROM generation_jobs WHERE id = 'old-job'`,
    ),
  ).toEqual({ status: 'failed', snapshot_json: null, diagnostic_json: null });
});
