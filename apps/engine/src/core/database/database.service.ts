import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import Database from 'better-sqlite3';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EngineConfig } from '../config/config.js';
import { appMeta } from './app-meta.schema.js';
import { packageRoot } from '../../package-root.js';

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly sqlite: Database.Database;
  readonly db;

  constructor(config: EngineConfig) {
    mkdirSync(join(config.dataDir, 'data'), { recursive: true });
    mkdirSync(join(config.dataDir, 'media'), { recursive: true });
    this.sqlite = new Database(join(config.dataDir, 'data/frame-loom.sqlite'));
    this.db = drizzle(this.sqlite);
    try {
      this.sqlite.pragma('journal_mode = WAL');
      this.sqlite.pragma('foreign_keys = ON');
      const migrationsFolder = fileURLToPath(new URL('drizzle/', packageRoot));
      const exists = this.sqlite
        .prepare("SELECT name FROM sqlite_master WHERE name = '__drizzle_migrations'")
        .get();
      if (exists) {
        const last = this.sqlite
          .prepare('SELECT MAX(created_at) AS version FROM __drizzle_migrations')
          .get() as { version: number | null };
        if (
          readMigrationFiles({ migrationsFolder }).some(
            (migration) => migration.folderMillis > (last.version ?? 0),
          )
        ) {
          // VACUUM INTO 包含 WAL 中的已提交数据；备份失败就停止升级。
          const backup = join(
            config.dataDir,
            'data',
            `frame-loom.before-${last.version ?? 0}-${Date.now()}.sqlite`,
          );
          this.sqlite.prepare('VACUUM INTO ?').run(backup);
        }
      }
      migrate(this.db, {
        migrationsFolder,
      });
      this.getSchemaVersion();
    } catch (error) {
      this.sqlite.close();
      throw error;
    }
  }

  getSchemaVersion(): string {
    const meta = this.db.select().from(appMeta).where(eq(appMeta.key, 'schema_version')).get();
    if (!meta) throw new Error('数据库缺少 schema 版本');
    return meta.value;
  }

  onModuleDestroy(): void {
    this.sqlite.close();
  }
}
