import { createRequire } from 'node:module';
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { videoProfiles } from '../../../engine/dist/modules/generation/profiles/video-profiles.js';

const require = createRequire(new URL('../../../engine/package.json', import.meta.url));
const Database = require('better-sqlite3');
const { drizzle } = require('drizzle-orm/better-sqlite3');
const { migrate } = require('drizzle-orm/better-sqlite3/migrator');
const directory = process.argv[2];
mkdirSync(join(directory, 'data'), { recursive: true });
const migrations = join(directory, 'legacy-migrations');
cpSync(fileURLToPath(new URL('../../../engine/drizzle/', import.meta.url)), migrations, {
  recursive: true,
});
const journalPath = join(migrations, 'meta/_journal.json');
const journal = JSON.parse(readFileSync(journalPath, 'utf8'));
writeFileSync(journalPath, JSON.stringify({ ...journal, entries: journal.entries.slice(0, 12) }));
const sqlite = new Database(join(directory, 'data/frame-loom.sqlite'));
migrate(drizzle(sqlite), { migrationsFolder: migrations });
const channelId = '11111111-1111-4111-8111-111111111111';
const modelId = '22222222-2222-4222-8222-222222222222';
const jobId = '33333333-3333-4333-8333-333333333333';
const now = new Date().toISOString();
sqlite
  .prepare(
    `INSERT INTO channels (id,name,api_format,base_url,header_names,enabled,created_at,updated_at) VALUES (?, '升级测试', 'openai-completions', 'https://example.test/deploy/v1', '[]', 1, ?, ?)`,
  )
  .run(channelId, now, now);
sqlite
  .prepare(
    `INSERT INTO channel_models (id,channel_id,upstream_model_id,display_name,kind,protocol,overrides_json,connection_json,enabled) VALUES (?, ?, 'unknown-cost-suffix', '待核对视频', 'video', 'openai-videos', '{}', '{}', 1)`,
  )
  .run(modelId, channelId);
sqlite.prepare("INSERT INTO model_defaults VALUES ('video', ?)").run(modelId);
sqlite
  .prepare(
    `INSERT INTO generation_jobs (id,kind,channel_model_id,profile_id,profile_json,status,request_json,outputs_json,source,created_at,updated_at,deadline_at) VALUES (?, 'video', ?, 'openai-videos-default', ?, 'paused', ?, '[]', 'canvas', ?, ?, ?)`,
  )
  .run(
    jobId,
    modelId,
    JSON.stringify(videoProfiles.find((profile) => profile.id === 'openai-videos-default')),
    JSON.stringify({
      modelId,
      mode: 'text',
      prompt: '保留的历史内容',
      params: {},
      inputs: [],
      source: 'canvas',
    }),
    now,
    now,
    now,
  );
sqlite.close();
