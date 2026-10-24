import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import Database from 'better-sqlite3';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EngineConfig } from './config.js';
import { appMeta } from './schema.js';

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
      migrate(this.db, {
        migrationsFolder: fileURLToPath(new URL('../drizzle/', import.meta.url)),
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
