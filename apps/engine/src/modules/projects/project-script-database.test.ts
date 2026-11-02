import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, expect, it } from 'vitest';
import { ProjectScriptDatabase } from './project-script-database.js';

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});
async function setup() {
  const root = await fs.mkdtemp(join(tmpdir(), 'loom-script-db-'));
  roots.push(root);
  return { root, id: randomUUID(), database: new ProjectScriptDatabase() };
}
it('P06 缺库、坏库、身份不符、过新版本不被重建', async () => {
  const { root, id, database } = await setup();
  await expect(database.use(root, id, () => null)).rejects.toMatchObject({
    code: 'PROJECT_DATABASE_UNAVAILABLE',
  });
  await database.create(root, id);
  await expect(database.use(root, randomUUID(), () => null)).rejects.toMatchObject({
    code: 'PROJECT_DATABASE_UNAVAILABLE',
  });
  await database.use(root, id, (db) =>
    db.prepare('UPDATE script_store_meta SET schema_version=99').run(),
  );
  const path = join(root, '.frameloom/project.sqlite');
  const before = await fs.readFile(path);
  await expect(database.use(root, id, () => null)).rejects.toMatchObject({
    code: 'PROJECT_DATABASE_UNAVAILABLE',
  });
  expect(await fs.readFile(path)).toEqual(before);
  await fs.writeFile(path, '损坏数据库');
  await expect(database.use(root, id, () => null)).rejects.toMatchObject({
    code: 'PROJECT_DATABASE_UNAVAILABLE',
  });
  expect(await fs.readFile(path, 'utf8')).toBe('损坏数据库');
});
it('P11 外键、字段类型、统一名称空间、排序和回滚由真实 SQLite 约束', async () => {
  const { root, id, database } = await setup();
  await database.create(root, id);
  await database.use(root, id, (db) => {
    const episode = randomUUID();
    db.prepare(
      "INSERT INTO episodes(id,number,title,created_at,updated_at) VALUES (?,1,'','','')",
    ).run(episode);
    expect(() =>
      db
        .prepare(
          "INSERT INTO episodes(id,number,title,created_at,updated_at) VALUES (?,1,'','','')",
        )
        .run(randomUUID()),
    ).toThrow();
    expect(() =>
      db.prepare('UPDATE episodes SET duration_sec = 1.5 WHERE id=?').run(episode),
    ).toThrow();
    expect(() =>
      db.prepare("INSERT INTO script_scenes VALUES ('scene','missing',0,'',NULL,'夜',1,'')").run(),
    ).toThrow();
    db.prepare("INSERT INTO script_scenes VALUES ('scene',?,0,'',NULL,'夜',1,'')").run(episode);
    expect(() =>
      db.prepare("INSERT INTO script_scenes VALUES ('other',?,0,'',NULL,'夜',1,'')").run(episode),
    ).toThrow();
    db.prepare(
      "INSERT INTO script_beats VALUES ('beat','scene',0,'action','文本',NULL,NULL,NULL,NULL)",
    ).run();
    expect(() => db.prepare("UPDATE script_beats SET type='sound'").run()).toThrow();
    expect(() => db.prepare("UPDATE script_beats SET speaker='甲'").run()).toThrow();
    for (const element of ['one', 'two'])
      db.prepare(
        "INSERT INTO story_elements(id,kind,name,status,created_at,updated_at) VALUES (?,'character',?,'pending','','')",
      ).run(element, element);
    db.prepare("INSERT INTO story_element_names VALUES ('one','character','林夏','林夏',0)").run();
    expect(() => db.prepare("UPDATE script_scenes SET location_id='one'").run()).toThrow(
      'location must reference location',
    );
    db.prepare(
      "INSERT INTO story_elements(id,kind,name,status,created_at,updated_at) VALUES ('place','location','门口','pending','','')",
    ).run();
    expect(() =>
      db.prepare("INSERT INTO scene_characters VALUES ('scene',0,'门口','place')").run(),
    ).toThrow('scene character must reference character');
    expect(() =>
      db
        .prepare(
          "INSERT INTO script_beats VALUES ('wrong','scene',1,'dialogue',NULL,'门口','place','','')",
        )
        .run(),
    ).toThrow('speaker must reference character');
    expect(() =>
      db
        .prepare("INSERT INTO story_element_names VALUES ('two','character','林夏','林夏',1)")
        .run(),
    ).toThrow();
    expect(() =>
      db.prepare("INSERT INTO story_element_names VALUES ('one','location','林夏','林夏',1)").run(),
    ).toThrow();
    expect(() =>
      db.transaction(() => {
        db.prepare('UPDATE episodes SET revision=2 WHERE id=?').run(episode);
        db.prepare('DELETE FROM script_scenes WHERE id=?').run('scene');
        throw new Error('模拟失败');
      })(),
    ).toThrow('模拟失败');
    expect(db.prepare('SELECT revision FROM episodes').get()).toEqual({ revision: 1 });
    expect(db.prepare('SELECT count(*) AS count FROM script_beats').get()).toEqual({ count: 1 });
    db.prepare('DELETE FROM episodes WHERE id=?').run(episode);
    expect(db.prepare('SELECT count(*) AS count FROM script_beats').get()).toEqual({ count: 0 });
  });
});
it('P07/P08 写操作结束释放句柄，Windows 移动目录后可继续写入', async () => {
  const { root, id, database } = await setup();
  await database.create(root, id);
  await database.use(root, id, (db) =>
    db.prepare('UPDATE script_store_meta SET story_revision=3').run(),
  );
  const moved = `${root}-moved`;
  roots.push(moved);
  await fs.rename(root, moved);
  expect(
    await database.use(moved, id, (db) =>
      db.prepare('SELECT story_revision FROM script_store_meta').get(),
    ),
  ).toEqual({ story_revision: 3 });
  await database.use(moved, id, (db) =>
    db.prepare('UPDATE script_store_meta SET story_revision=4').run(),
  );
});
