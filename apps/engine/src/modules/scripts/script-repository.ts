import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import {
  EditableScriptDocument,
  EpisodeSummary,
  StoryElement,
  elementNameKey,
  projectScriptDocument,
  type ElementKind,
  type ProjectManifest,
  type StoryOccurrencesResult,
} from '@frame-loom/contracts';
import { DomainError } from '../../core/http/domain-error.js';

export const EpisodeRow = z.object({
  id: z.string().uuid(),
  number: z.number(),
  title: z.string(),
  duration_sec: z.number(),
  revision: z.number(),
  core_conflict: z.string(),
  hook_start: z.string(),
  hook_end: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
  deleted_at: z.string().nullable(),
});
export function episodeRow(db: Database.Database, id: string) {
  const row = db.prepare('SELECT * FROM episodes WHERE id=? AND deleted_at IS NULL').get(id);
  if (!row) throw new DomainError('EPISODE_NOT_FOUND', 404, '剧集不存在');
  return EpisodeRow.parse(row);
}
export function episodeSummaries(db: Database.Database) {
  return z
    .array(EpisodeRow)
    .parse(db.prepare('SELECT * FROM episodes WHERE deleted_at IS NULL ORDER BY number').all())
    .map((row) => {
      const counts = z.object({ scenes: z.number(), chars: z.number() }).parse(
        db
          .prepare(
            `
      SELECT (SELECT count(*) FROM script_scenes WHERE episode_id=?) AS scenes,
      coalesce((SELECT sum(length(coalesce(b.content,b.line,''))) FROM script_beats b JOIN script_scenes s ON s.id=b.scene_id WHERE s.episode_id=?),0) AS chars
    `,
          )
          .get(row.id, row.id),
      );
      return EpisodeSummary.parse({
        id: row.id,
        number: row.number,
        title: row.title,
        duration_sec: row.duration_sec,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        ...counts,
        draft: counts.scenes === 0,
      });
    });
}
export function readDocument(db: Database.Database, manifest: ProjectManifest, episodeId: string) {
  const row = episodeRow(db, episodeId);
  const scenes = z
    .array(
      z.object({
        id: z.string(),
        location: z.string(),
        time_of_day: z.enum(['日', '夜']),
        interior: z.number(),
        atmosphere: z.string(),
      }),
    )
    .parse(
      db.prepare('SELECT * FROM script_scenes WHERE episode_id=? ORDER BY ordinal').all(episodeId),
    );
  const doc = EditableScriptDocument.parse({
    meta: {
      series: '',
      episode: row.number,
      title: '',
      genre: '',
      duration_sec: 0,
      style: '',
      core_conflict: row.core_conflict,
      hook_start: row.hook_start,
      hook_end: row.hook_end,
    },
    scenes: scenes.map((scene, index) => ({
      ...scene,
      interior: !!scene.interior,
      scene_id: `${row.number}-${index + 1}`,
      characters: z
        .array(z.object({ name: z.string() }))
        .parse(
          db
            .prepare('SELECT name FROM scene_characters WHERE scene_id=? ORDER BY ordinal')
            .all(scene.id),
        )
        .map((c) => c.name),
      beats: z
        .array(
          z.object({
            id: z.string(),
            type: z.enum(['action', 'dialogue']),
            content: z.string().nullable(),
            speaker: z.string().nullable(),
            emotion: z.string().nullable(),
            line: z.string().nullable(),
          }),
        )
        .parse(
          db.prepare('SELECT * FROM script_beats WHERE scene_id=? ORDER BY ordinal').all(scene.id),
        )
        .map((b) =>
          b.type === 'action'
            ? { id: b.id, type: b.type, content: b.content }
            : { id: b.id, type: b.type, speaker: b.speaker, emotion: b.emotion, line: b.line },
        ),
    })),
  });
  return projectScriptDocument(doc, { ...manifest, episode: row });
}
export function readElements(db: Database.Database): StoryElement[] {
  const rows = z
    .array(
      z.object({
        id: z.string(),
        kind: z.string(),
        name: z.string(),
        status: z.string(),
        description: z.string(),
        attrs: z.string(),
        manually_edited: z.number(),
        created_at: z.string(),
        updated_at: z.string(),
      }),
    )
    .parse(db.prepare('SELECT * FROM story_elements ORDER BY created_at,id').all());
  return rows.map((row) =>
    StoryElement.parse({
      id: row.id,
      kind: row.kind,
      name: row.name,
      status: row.status,
      description: row.description,
      attrs: JSON.parse(row.attrs) as unknown,
      manuallyEdited: !!row.manually_edited,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      aliases: z
        .array(z.object({ name: z.string() }))
        .parse(
          db
            .prepare(
              'SELECT name FROM story_element_names WHERE element_id=? AND ordinal>0 ORDER BY ordinal',
            )
            .all(row.id),
        )
        .map((n) => n.name),
    }),
  );
}
export function writeElement(db: Database.Database, value: StoryElement) {
  const element = StoryElement.parse(value);
  for (const name of [element.name, ...element.aliases]) {
    const collision = db
      .prepare(
        'SELECT element_id FROM story_element_names WHERE kind=? AND name_key=? AND element_id<>?',
      )
      .get(element.kind, elementNameKey(name), element.id);
    if (collision) throw new DomainError('STORY_NAME_CONFLICT', 409, '同类设定名称或别名已存在');
  }
  db.prepare(
    `INSERT INTO story_elements(id,kind,name,status,description,attrs,manually_edited,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name,status=excluded.status,description=excluded.description,attrs=excluded.attrs,manually_edited=excluded.manually_edited,updated_at=excluded.updated_at`,
  ).run(
    element.id,
    element.kind,
    element.name,
    element.status,
    element.description,
    JSON.stringify(element.attrs),
    +element.manuallyEdited,
    element.createdAt,
    element.updatedAt,
  );
  db.prepare('DELETE FROM story_element_names WHERE element_id=?').run(element.id);
  for (const [index, name] of [element.name, ...element.aliases].entries())
    db.prepare('INSERT INTO story_element_names VALUES (?,?,?,?,?)').run(
      element.id,
      element.kind,
      name,
      elementNameKey(name),
      index,
    );
}
function resolveElement(
  db: Database.Database,
  kind: ElementKind,
  raw: string,
): { id: string | null; added: number } {
  const name = raw.trim();
  if (
    !name ||
    db
      .prepare('SELECT 1 FROM story_ignored_names WHERE kind=? AND name_key=?')
      .get(kind, elementNameKey(name))
  )
    return { id: null, added: 0 };
  const existing = z
    .object({ element_id: z.string() })
    .optional()
    .parse(
      db
        .prepare('SELECT element_id FROM story_element_names WHERE kind=? AND name_key=?')
        .get(kind, elementNameKey(name)),
    );
  if (existing) return { id: existing.element_id, added: 0 };
  const now = new Date().toISOString();
  const element: StoryElement = {
    id: randomUUID(),
    kind,
    name,
    aliases: [],
    description: '',
    attrs: {},
    status: 'pending',
    manuallyEdited: false,
    createdAt: now,
    updatedAt: now,
  };
  writeElement(db, element);
  return { id: element.id, added: 1 };
}
export function pruneOrphans(db: Database.Database) {
  const candidates = z.array(z.object({ id: z.string() })).parse(
    db
      .prepare(
        `SELECT id FROM story_elements WHERE status='pending' AND manually_edited=0
    AND id NOT IN (SELECT location_id FROM script_scenes WHERE location_id IS NOT NULL)
    AND id NOT IN (SELECT speaker_id FROM script_beats WHERE speaker_id IS NOT NULL)
    AND id NOT IN (SELECT element_id FROM scene_characters WHERE element_id IS NOT NULL)`,
      )
      .all(),
  );
  const elements = readElements(db);
  for (const candidate of candidates) {
    const element = elements.find((value) => value.id === candidate.id)!;
    if (!occurrences(db, element).length)
      db.prepare('DELETE FROM story_elements WHERE id=?').run(element.id);
  }
}
// 调用方拥有事务，正文、关系、设定和 revision 只在同一次提交生效。
export function saveDocument(
  db: Database.Database,
  episodeId: string,
  revision: number,
  input: EditableScriptDocument,
) {
  const row = episodeRow(db, episodeId);
  if (row.revision !== revision)
    throw new DomainError(
      'SCRIPT_REVISION_CONFLICT',
      409,
      '剧本已被修改，当前草稿已保留，请重新加载后处理',
    );
  const doc = EditableScriptDocument.parse(input);
  for (const scene of doc.scenes) {
    const owner = z
      .object({ episode_id: z.string() })
      .optional()
      .parse(db.prepare('SELECT episode_id FROM script_scenes WHERE id=?').get(scene.id));
    if (owner && owner.episode_id !== episodeId)
      throw new DomainError('SCRIPT_ID_CONFLICT', 409, '场次身份属于其他剧集');
    for (const beat of scene.beats) {
      const beatOwner = z
        .object({ episode_id: z.string() })
        .optional()
        .parse(
          db
            .prepare(
              'SELECT s.episode_id FROM script_beats b JOIN script_scenes s ON s.id=b.scene_id WHERE b.id=?',
            )
            .get(beat.id),
        );
      if (beatOwner && beatOwner.episode_id !== episodeId)
        throw new DomainError('SCRIPT_ID_CONFLICT', 409, '内容身份属于其他剧集');
    }
  }
  db.prepare('DELETE FROM script_scenes WHERE episode_id=?').run(episodeId);
  let addedElements = 0;
  for (const [ordinal, scene] of doc.scenes.entries()) {
    const location = resolveElement(db, 'location', scene.location);
    addedElements += location.added;
    db.prepare('INSERT INTO script_scenes VALUES (?,?,?,?,?,?,?,?)').run(
      scene.id,
      episodeId,
      ordinal,
      scene.location,
      location.id,
      scene.time_of_day,
      +scene.interior,
      scene.atmosphere,
    );
    const names = [
      ...scene.characters,
      ...scene.beats.flatMap((b) => (b.type === 'dialogue' && b.speaker.trim() ? [b.speaker] : [])),
    ];
    const seen = new Set<string>();
    let position = 0;
    for (const name of names) {
      const found = resolveElement(db, 'character', name);
      addedElements += found.added;
      const key = found.id ?? elementNameKey(name);
      if (seen.has(key) || !name.trim()) continue;
      seen.add(key);
      db.prepare('INSERT INTO scene_characters VALUES (?,?,?,?)').run(
        scene.id,
        position++,
        name,
        found.id,
      );
    }
    for (const [index, beat] of scene.beats.entries()) {
      const speaker =
        beat.type === 'dialogue'
          ? resolveElement(db, 'character', beat.speaker)
          : { id: null, added: 0 };
      addedElements += speaker.added;
      db.prepare('INSERT INTO script_beats VALUES (?,?,?,?,?,?,?,?,?)').run(
        beat.id,
        scene.id,
        index,
        beat.type,
        beat.type === 'action' ? beat.content : null,
        beat.type === 'dialogue' ? beat.speaker : null,
        speaker.id,
        beat.type === 'dialogue' ? beat.emotion : null,
        beat.type === 'dialogue' ? beat.line : null,
      );
    }
  }
  db.prepare(
    'UPDATE episodes SET revision=revision+1,core_conflict=?,hook_start=?,hook_end=?,updated_at=? WHERE id=?',
  ).run(
    doc.meta.core_conflict,
    doc.meta.hook_start,
    doc.meta.hook_end,
    new Date().toISOString(),
    episodeId,
  );
  db.prepare('UPDATE script_store_meta SET story_revision=story_revision+1').run();
  pruneOrphans(db);
  return { revision: revision + 1, addedElements };
}
export function occurrences(db: Database.Database, element: StoryElement): StoryOccurrencesResult {
  const result: StoryOccurrencesResult = [];
  const scenes = z
    .array(
      z.object({
        id: z.string(),
        episode_id: z.string(),
        location_id: z.string().nullable(),
        location: z.string(),
      }),
    )
    .parse(
      db
        .prepare(
          'SELECT s.* FROM script_scenes s JOIN episodes e ON e.id=s.episode_id WHERE e.deleted_at IS NULL ORDER BY e.number,s.ordinal',
        )
        .all(),
    );
  const terms = readElements(db)
    .flatMap((e) => [e.name, ...e.aliases].map((name) => ({ id: e.id, text: name })))
    .sort((a, b) => b.text.length - a.text.length);
  for (const scene of scenes) {
    const present =
      scene.location_id === element.id ||
      !!db
        .prepare('SELECT 1 FROM scene_characters WHERE scene_id=? AND element_id=?')
        .get(scene.id, element.id);
    if (present)
      result.push({
        episodeId: scene.episode_id,
        sceneId: scene.id,
        beatId: null,
        excerpt: scene.location.slice(0, 80),
      });
    const beats = z
      .array(
        z.object({
          id: z.string(),
          content: z.string().nullable(),
          line: z.string().nullable(),
          speaker_id: z.string().nullable(),
        }),
      )
      .parse(
        db.prepare('SELECT * FROM script_beats WHERE scene_id=? ORDER BY ordinal').all(scene.id),
      );
    for (const beat of beats) {
      const text = beat.content ?? beat.line ?? '';
      let match = beat.speaker_id === element.id;
      for (let offset = 0; offset < text.length;) {
        const term = terms.find(
          (t) => text.slice(offset, offset + t.text.length).toLowerCase() === t.text.toLowerCase(),
        );
        if (term) {
          if (term.id === element.id) match = true;
          offset += term.text.length;
        } else offset++;
      }
      if (match)
        result.push({
          episodeId: scene.episode_id,
          sceneId: scene.id,
          beatId: beat.id,
          excerpt: text.slice(0, 80),
        });
    }
  }
  return result;
}
