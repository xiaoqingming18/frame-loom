import { sql } from 'drizzle-orm';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { EngineConfig } from './config.js';
import { DatabaseService } from './database.service.js';
import { appMeta } from './schema.js';

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
    count: 1,
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
    count: 1,
  });
});

it('数据库损坏时拒绝启动，关闭失败连接后仍可清理文件', () => {
  const { database, config } = openDatabase();
  databases.pop();
  database.onModuleDestroy();
  writeFileSync(join(config.dataDir, 'data/frame-loom.sqlite'), '损坏的数据库');
  expect(() => new DatabaseService(config)).toThrow();
});
