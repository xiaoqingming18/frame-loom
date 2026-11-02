import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import {
  StoryElement,
  elementNameKey,
  elementAttrsSchema,
  type ElementKind,
  type StoryElementCreateRequest,
  type StoryElementUpdateRequest,
  type StoryElementMergeRequest,
} from '@frame-loom/contracts';
import { DomainError } from '../../core/http/domain-error.js';
import { EpisodesService } from './episodes.service.js';
import { readElements, writeElement, occurrences } from './script-repository.js';

@Injectable()
export class StoryService {
  constructor(private readonly episodes: EpisodesService) {}
  private async use<T>(
    projectId: string,
    operation: (db: Database.Database) => T,
    mutation = false,
  ) {
    return this.episodes.store.serial(projectId, async () => {
      const { root } = await this.episodes.context(projectId);
      return this.episodes.database.use(root, projectId, (db) =>
        mutation
          ? db.transaction(() => {
              const result = operation(db);
              db.prepare('UPDATE script_store_meta SET story_revision=story_revision+1').run();
              return result;
            })()
          : operation(db),
      );
    });
  }
  private element(db: Database.Database, id: string) {
    const found = readElements(db).find((e) => e.id === id);
    if (!found) throw new DomainError('STORY_ELEMENT_NOT_FOUND', 404, '设定不存在');
    return found;
  }
  list(projectId: string) {
    return this.use(projectId, (db) => {
      const revision = z
        .object({ story_revision: z.number() })
        .parse(db.prepare('SELECT story_revision FROM script_store_meta').get()).story_revision;
      return {
        revision,
        ignored: db
          .prepare('SELECT kind,name FROM story_ignored_names ORDER BY kind,name_key')
          .all(),
        elements: readElements(db).map((element) => {
          const refs = occurrences(db, element);
          return {
            ...element,
            mentions: refs.length,
            episodes: [...new Set(refs.map((o) => o.episodeId))].map((episodeId) => ({
              episodeId,
              scenes: new Set(refs.filter((o) => o.episodeId === episodeId).map((o) => o.sceneId))
                .size,
            })),
          };
        }),
      };
    });
  }
  create(projectId: string, input: StoryElementCreateRequest) {
    return this.use(
      projectId,
      (db) => {
        const now = new Date().toISOString();
        const element: StoryElement = {
          id: randomUUID(),
          ...input,
          aliases: [],
          description: '',
          attrs: {},
          status: 'confirmed',
          manuallyEdited: true,
          createdAt: now,
          updatedAt: now,
        };
        writeElement(db, element);
        return element;
      },
      true,
    );
  }
  update(projectId: string, id: string, patch: StoryElementUpdateRequest) {
    return this.use(
      projectId,
      (db) => {
        const old = this.element(db, id);
        const aliases = [...(patch.aliases ?? old.aliases)];
        if (
          patch.name &&
          elementNameKey(patch.name) !== elementNameKey(old.name) &&
          !aliases.some((a) => elementNameKey(a) === elementNameKey(old.name))
        )
          aliases.push(old.name);
        const element = StoryElement.parse({
          ...old,
          ...patch,
          aliases,
          manuallyEdited: true,
          updatedAt: new Date().toISOString(),
        });
        writeElement(db, element);
        return element;
      },
      true,
    );
  }
  merge(projectId: string, id: string, input: StoryElementMergeRequest) {
    return this.use(
      projectId,
      (db) => {
        const source = this.element(db, id),
          target = this.element(db, input.into);
        if (source.id === target.id || source.kind !== target.kind)
          throw new DomainError('STORY_MERGE_INVALID', 422, '只能合并同类的不同设定');
        const conflicts = Object.entries(source.attrs).filter(
          ([key, value]) =>
            JSON.stringify(value) !== JSON.stringify(Reflect.get(target.attrs, key)),
        );
        if (
          (conflicts.length && input.attrs === undefined) ||
          (source.description &&
            source.description !== target.description &&
            input.description === undefined)
        )
          throw new DomainError(
            'STORY_MERGE_CONFLICT',
            409,
            '来源资料存在差异，请选择保留的字段后再合并',
          );
        const aliases = [
          ...new Map(
            [...target.aliases, source.name, ...source.aliases]
              .filter((n) => elementNameKey(n) !== elementNameKey(target.name))
              .map((n) => [elementNameKey(n), n]),
          ).values(),
        ];
        const merged = StoryElement.parse({
          ...target,
          aliases,
          attrs: elementAttrsSchema(target.kind).parse(input.attrs ?? target.attrs),
          description: input.description ?? target.description,
          manuallyEdited: true,
          updatedAt: new Date().toISOString(),
        });
        db.prepare('UPDATE script_scenes SET location_id=? WHERE location_id=?').run(
          target.id,
          source.id,
        );
        db.prepare('UPDATE script_beats SET speaker_id=? WHERE speaker_id=?').run(
          target.id,
          source.id,
        );
        db.prepare(
          'DELETE FROM scene_characters WHERE element_id=? AND scene_id IN (SELECT scene_id FROM scene_characters WHERE element_id=?)',
        ).run(source.id, target.id);
        db.prepare('UPDATE scene_characters SET element_id=? WHERE element_id=?').run(
          target.id,
          source.id,
        );
        db.prepare('DELETE FROM story_elements WHERE id=?').run(source.id);
        writeElement(db, merged);
        return merged;
      },
      true,
    );
  }
  private ignore(db: Database.Database, id: string) {
    const element = this.element(db, id);
    for (const name of [element.name, ...element.aliases])
      db.prepare('INSERT OR IGNORE INTO story_ignored_names VALUES (?,?,?)').run(
        element.kind,
        name,
        elementNameKey(name),
      );
    db.prepare('DELETE FROM story_elements WHERE id=?').run(id);
  }
  remove(projectId: string, id: string) {
    return this.use(
      projectId,
      (db) => {
        this.ignore(db, id);
        return { saved: true };
      },
      true,
    );
  }
  restore(projectId: string, kind: ElementKind, name: string) {
    return this.use(
      projectId,
      (db) => {
        db.prepare('DELETE FROM story_ignored_names WHERE kind=? AND name_key=?').run(
          kind,
          elementNameKey(name),
        );
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
        for (const term of [name]) {
          if (kind === 'location')
            db.prepare('UPDATE script_scenes SET location_id=? WHERE lower(trim(location))=?').run(
              element.id,
              elementNameKey(term),
            );
          if (kind === 'character') {
            db.prepare('UPDATE script_beats SET speaker_id=? WHERE lower(trim(speaker))=?').run(
              element.id,
              elementNameKey(term),
            );
            db.prepare('UPDATE scene_characters SET element_id=? WHERE lower(trim(name))=?').run(
              element.id,
              elementNameKey(term),
            );
          }
        }
        return { saved: true };
      },
      true,
    );
  }
  batch(projectId: string, ids: string[], action: 'confirm' | 'ignore') {
    return this.use(
      projectId,
      (db) => {
        for (const id of ids) {
          this.element(db, id);
          if (action === 'ignore') this.ignore(db, id);
          else
            db.prepare("UPDATE story_elements SET status='confirmed',updated_at=? WHERE id=?").run(
              new Date().toISOString(),
              id,
            );
        }
        return { saved: true };
      },
      true,
    );
  }
  findOccurrences(projectId: string, id: string) {
    return this.use(projectId, (db) => occurrences(db, this.element(db, id)).slice(0, 200));
  }
}
