import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';
import { EngineConfig } from '../config/config.js';
import { DatabaseService } from './database.service.js';
import { packageRoot } from '../../package-root.js';

const directories: string[] = [];
const databases: DatabaseService[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.onModuleDestroy();
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function setup(legacy = false) {
  const dir = mkdtempSync(join(tmpdir(), 'loom-db-reset-'));
  directories.push(dir);
  const config = new EngineConfig('a'.repeat(64), dir, []);
  if (!legacy) return { dir, config };
  const folder = join(dir, 'migrations');
  cpSync(fileURLToPath(new URL('drizzle/', packageRoot)), folder, { recursive: true });
  const journalPath = join(folder, 'meta/_journal.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: unknown[] };
  journal.entries = journal.entries.slice(0, 15);
  writeFileSync(journalPath, JSON.stringify(journal));
  mkdirSync(join(dir, 'data'));
  const sqlite = new Database(join(dir, 'data/frame-loom.sqlite'));
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('journal_mode = WAL');
  migrate(drizzle(sqlite), { migrationsFolder: folder });
  sqlite.exec(`INSERT INTO channels (id,name,api_format,base_url,header_names,enabled,created_at,updated_at) VALUES ('old','旧渠道','openai-completions','https://example.test/v1','[]',1,'','');
    INSERT INTO channel_models (id,channel_id,upstream_model_id,display_name,kind,protocol,overrides_json,connection_json,enabled) VALUES ('old-model','old','old','旧模型','image','openai-images','{}','{}',1);
    INSERT INTO generation_jobs (id,kind,channel_model_id,profile_id,profile_json,status,request_json,outputs_json,source,created_at,updated_at,deadline_at) VALUES ('old-job','image','old-model','old','{}','failed','{}','[]','canvas','','','');
    INSERT INTO app_meta VALUES ('model_bindings_v1','1'), ('model_upgrade_report','[]'), ('image_edit_capabilities_v1','1');
    INSERT INTO projects (id,name,root_path,created_at,updated_at,added_at,last_opened_at) VALUES ('project','保留项目','D:/test','','','','');
    INSERT INTO media_files (sha256,mime,bytes,created_at,ext) VALUES ('hash','image/png',42,'','png');`);
  sqlite.close();
  return { dir, config };
}
function open(config: EngineConfig) {
  const db = new DatabaseService(config);
  databases.push(db);
  return db;
}
it('空库创建版本 8，重复启动不备份，WAL 与外键启用', () => {
  const { dir, config } = setup();
  const db = open(config);
  expect(db.getSchemaVersion()).toBe('8');
  const sqlite = new Database(join(dir, 'data/frame-loom.sqlite'));
  try {
    expect(sqlite.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(sqlite.prepare('SELECT count(*) AS n FROM __drizzle_migrations').get()).toEqual({
      n: 16,
    });
  } finally {
    sqlite.close();
  }
  databases.pop();
  db.onModuleDestroy();
  expect(() => db.getSchemaVersion()).toThrow();
  open(config);
  expect(
    readdirSync(join(dir, 'data')).filter((name) => name.startsWith('frame-loom.before-')),
  ).toEqual([]);
});
it('0015 只清模型与任务，项目资产保留，升级前备份可读且包含旧记录', () => {
  const { dir, config } = setup(true);
  expect(open(config).getSchemaVersion()).toBe('8');
  const sqlite = new Database(join(dir, 'data/frame-loom.sqlite'));
  try {
    for (const table of ['channels', 'models', 'generation_jobs', 'model_defaults', 'tts_voices'])
      expect(sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get()).toEqual({ n: 0 });
    for (const table of ['channel_models', 'model_catalog', 'provider_uploads'])
      expect(
        sqlite.prepare('SELECT name FROM sqlite_master WHERE name = ?').get(table),
      ).toBeUndefined();
    expect(sqlite.prepare("SELECT name FROM projects WHERE id = 'project'").get()).toEqual({
      name: '保留项目',
    });
    expect(sqlite.prepare("SELECT bytes FROM media_files WHERE sha256 = 'hash'").get()).toEqual({
      bytes: 42,
    });
    expect(
      sqlite
        .prepare(
          "SELECT key FROM app_meta WHERE key IN ('model_bindings_v1','model_upgrade_report','image_edit_capabilities_v1')",
        )
        .all(),
    ).toEqual([]);
    expect(sqlite.prepare('PRAGMA table_info(generation_jobs)').all()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'snapshot_json', notnull: 1 }),
        expect.objectContaining({ name: 'model_id', notnull: 1 }),
      ]),
    );
    expect(sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally {
    sqlite.close();
  }
  const backups = readdirSync(join(dir, 'data')).filter((name) =>
    name.startsWith('frame-loom.before-'),
  );
  expect(backups).toHaveLength(1);
  const backup = new Database(join(dir, 'data', backups[0]), { readonly: true });
  try {
    expect(backup.prepare('SELECT id FROM generation_jobs').all()).toEqual([{ id: 'old-job' }]);
    expect(backup.prepare('SELECT id FROM channels').all()).toEqual([{ id: 'old' }]);
  } finally {
    backup.close();
  }
});
it('清库迁移中途失败整批回滚，不留下半删表', () => {
  const { dir } = setup(true);
  const folder = join(dir, 'failing');
  cpSync(fileURLToPath(new URL('drizzle/', packageRoot)), folder, { recursive: true });
  const path = join(folder, '0015_model_service_reset.sql');
  writeFileSync(
    path,
    readFileSync(path, 'utf8') +
      '\n--> statement-breakpoint\nINSERT INTO missing_table VALUES (1);',
  );
  const sqlite = new Database(join(dir, 'data/frame-loom.sqlite'));
  sqlite.pragma('foreign_keys = ON');
  try {
    expect(() => migrate(drizzle(sqlite), { migrationsFolder: folder })).toThrow();
    expect(sqlite.prepare('SELECT id FROM channels').all()).toEqual([{ id: 'old' }]);
    expect(sqlite.prepare('SELECT id FROM generation_jobs').all()).toEqual([{ id: 'old-job' }]);
    expect(sqlite.prepare("SELECT value FROM app_meta WHERE key = 'schema_version'").get()).toEqual(
      { value: '7' },
    );
  } finally {
    sqlite.close();
  }
});
it('损坏数据库拒绝启动并释放句柄', () => {
  const { dir, config } = setup();
  mkdirSync(join(dir, 'data'));
  writeFileSync(join(dir, 'data/frame-loom.sqlite'), '损坏数据库');
  expect(() => open(config)).toThrow();
});
