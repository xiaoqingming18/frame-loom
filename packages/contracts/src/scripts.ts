import { z } from 'zod';
import { EpisodeSummary, type ProjectProfile } from './projects.js';

export const ScriptId = z.string().uuid();
const Text = z.string().max(200000);
export function normalizeAction(content: string): string {
  return content.replace(/^(?:\s*△\s*)+/u, '');
}
export const ScriptMeta = z.strictObject({
  series: z.string().max(80),
  episode: z.number().int().min(1).max(9999),
  title: z.string().max(80),
  genre: z.string().max(100),
  duration_sec: z.number().int().nonnegative(),
  style: z.string().max(2000),
  core_conflict: Text,
  hook_start: Text,
  hook_end: Text,
});
export type ScriptMeta = z.infer<typeof ScriptMeta>;
export const ActionBeat = z.strictObject({
  type: z.literal('action'),
  content: Text.transform(normalizeAction),
});
export const DialogueBeat = z.strictObject({
  type: z.literal('dialogue'),
  speaker: z.string().max(40),
  emotion: z.string().max(200),
  line: Text,
});
export const ScriptBeat = z.discriminatedUnion('type', [ActionBeat, DialogueBeat]);
export type ScriptBeat = z.infer<typeof ScriptBeat>;
const SceneFields = {
  scene_id: z.string().regex(/^\d{1,4}-\d+$/u),
  location: z.string().max(200),
  time_of_day: z.enum(['日', '夜']),
  interior: z.boolean(),
  characters: z.array(z.string().min(1).max(40)).max(200),
  atmosphere: z.string().max(2000),
};
export const ScriptScene = z.strictObject({
  ...SceneFields,
  beats: z.array(ScriptBeat).max(10000),
});
export type ScriptScene = z.infer<typeof ScriptScene>;
export const ScriptDocument = z.strictObject({
  meta: ScriptMeta,
  scenes: z.array(ScriptScene).max(5000),
});
export type ScriptDocument = z.infer<typeof ScriptDocument>;
export const EditableScriptBeat = z.discriminatedUnion('type', [
  ActionBeat.extend({ id: ScriptId }),
  DialogueBeat.extend({ id: ScriptId }),
]);
export type EditableScriptBeat = z.infer<typeof EditableScriptBeat>;
export const EditableScriptScene = z.strictObject({
  ...SceneFields,
  id: ScriptId,
  beats: z.array(EditableScriptBeat).max(10000),
});
export type EditableScriptScene = z.infer<typeof EditableScriptScene>;
export const EditableScriptDocument = z
  .strictObject({ meta: ScriptMeta, scenes: z.array(EditableScriptScene).max(5000) })
  .superRefine((doc, ctx) => {
    const ids = new Set<string>();
    for (const scene of doc.scenes) {
      for (const node of [scene, ...scene.beats]) {
        if (ids.has(node.id)) ctx.addIssue({ code: 'custom', message: '场次或内容 id 重复' });
        ids.add(node.id);
      }
    }
  });
export type EditableScriptDocument = z.infer<typeof EditableScriptDocument>;
export type ScriptContext = {
  name: string;
  profile?: Pick<ProjectProfile, 'genres' | 'style'>;
  episode: Pick<EpisodeSummary, 'number' | 'title' | 'duration_sec'>;
};
export function projectScriptMeta(meta: ScriptMeta, context: ScriptContext): ScriptMeta {
  return {
    ...meta,
    series: context.name,
    genre: context.profile?.genres.join(' / ') ?? '',
    style: context.profile?.style ?? '',
    episode: context.episode.number,
    title: context.episode.title,
    duration_sec: context.episode.duration_sec,
  };
}
export function projectScriptDocument(
  doc: EditableScriptDocument,
  context: ScriptContext,
): EditableScriptDocument {
  return {
    meta: projectScriptMeta(doc.meta, context),
    scenes: doc.scenes.map((scene, index) => ({
      ...scene,
      scene_id: `${context.episode.number}-${index + 1}`,
    })),
  };
}
export function standardScriptDocument(doc: EditableScriptDocument): ScriptDocument {
  return ScriptDocument.parse({
    meta: doc.meta,
    scenes: doc.scenes.map(({ id, beats, ...scene }) => {
      void id;
      return {
        ...scene,
        beats: beats.map(({ id, ...beat }) => {
          void id;
          return beat;
        }),
      };
    }),
  });
}
export function createEditableScript(
  doc: ScriptDocument,
  newId: () => string = () => crypto.randomUUID(),
): EditableScriptDocument {
  return EditableScriptDocument.parse({
    meta: doc.meta,
    scenes: doc.scenes.map((scene) => ({
      ...scene,
      id: newId(),
      beats: scene.beats.map((beat) => ({ ...beat, id: newId() })),
    })),
  });
}
export function emptyScriptDocument(context: ScriptContext): EditableScriptDocument {
  return {
    meta: projectScriptMeta(
      {
        series: '',
        episode: 1,
        title: '',
        genre: '',
        duration_sec: 0,
        style: '',
        core_conflict: '',
        hook_start: '',
        hook_end: '',
      },
      context,
    ),
    scenes: [],
  };
}
export const ConversionState = z.strictObject({
  status: z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled']),
  stage: z.enum(['locating', 'parsing', 'validating', 'applying']).nullable(),
  done: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  warnings: z.array(z.string()),
  error: z.string().nullable(),
  result: z
    .strictObject({
      scenes: z.number().int().nonnegative(),
      beats: z.number().int().nonnegative(),
      addedElements: z.number().int().nonnegative(),
    })
    .nullable(),
});
export type ConversionState = z.infer<typeof ConversionState>;
export const EpisodeCreateRequest = EpisodeSummary.pick({
  number: true,
  title: true,
  duration_sec: true,
});
export type EpisodeCreateRequest = z.infer<typeof EpisodeCreateRequest>;
export const EpisodeUpdateRequest = EpisodeCreateRequest.partial().refine(
  (patch) => Object.keys(patch).length > 0,
  '至少修改一个字段',
);
export type EpisodeUpdateRequest = z.infer<typeof EpisodeUpdateRequest>;
export const EpisodeResult = EpisodeSummary.extend({
  conversion: ConversionState.nullable(),
  pending: z.number().int().nonnegative(),
});
export type EpisodeResult = z.infer<typeof EpisodeResult>;
export const EpisodeListResult = z.array(EpisodeResult);
export const ScriptResult = z.strictObject({
  id: ScriptId,
  revision: z.number().int().positive(),
  document: EditableScriptDocument,
  conversion: ConversionState.nullable(),
  source: z.string().nullable(),
});
export type ScriptResult = z.infer<typeof ScriptResult>;
export const ScriptSaveRequest = ScriptResult.pick({ revision: true, document: true });
export type ScriptSaveRequest = z.infer<typeof ScriptSaveRequest>;
export const ScriptSaveResult = z.strictObject({
  revision: z.number().int().positive(),
  addedElements: z.number().int().nonnegative(),
});
export type ScriptSaveResult = z.infer<typeof ScriptSaveResult>;
export const ScriptImportRequest = z.strictObject({
  revision: z.number().int().positive(),
  text: z.string().min(1).max(200000).optional(),
});
export type ScriptImportRequest = z.infer<typeof ScriptImportRequest>;
export const ScriptImportResult = z.strictObject({
  revision: z.number().int().positive(),
  conversion: ConversionState,
});
export type ScriptImportResult = z.infer<typeof ScriptImportResult>;

export const ElementKind = z.enum(['character', 'location', 'prop', 'costume']);
export type ElementKind = z.infer<typeof ElementKind>;
export const ElementName = z.string().trim().min(1).max(200);
const List = z.array(z.string().max(200)).max(100);
export const CharacterProfile = z.strictObject({
  age: z.string().max(200).optional(),
  gender: z.string().max(200).optional(),
  appearance: List.optional(),
  personality: List.optional(),
  signatureActions: List.optional(),
  signatureProps: List.optional(),
});
export const LocationProfile = z.strictObject({
  spaceType: z.string().max(200).optional(),
  eraRegion: z.string().max(200).optional(),
  layout: z.string().max(2000).optional(),
  visualAnchors: List.optional(),
  colorsMaterials: z.string().max(2000).optional(),
  signatureFurnishings: List.optional(),
  notes: z.string().max(2000).optional(),
});
export const ElementAttrs = z.union([CharacterProfile, LocationProfile, z.strictObject({})]);
export type ElementAttrs = z.infer<typeof ElementAttrs>;
export function elementAttrsSchema(kind: ElementKind) {
  return kind === 'character'
    ? CharacterProfile
    : kind === 'location'
      ? LocationProfile
      : z.strictObject({});
}
export function elementNameKey(name: string): string {
  return name.trim().toLowerCase();
}
export const StoryElement = z
  .strictObject({
    id: ScriptId,
    kind: ElementKind,
    name: ElementName,
    aliases: z.array(ElementName).max(100),
    status: z.enum(['pending', 'confirmed']),
    description: z.string().max(2000),
    attrs: ElementAttrs,
    manuallyEdited: z.boolean(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .superRefine((element, ctx) => {
    if (!elementAttrsSchema(element.kind).safeParse(element.attrs).success)
      ctx.addIssue({ code: 'custom', message: '资料字段与设定类别不匹配' });
    const names = [element.name, ...element.aliases].map(elementNameKey);
    if (new Set(names).size !== names.length)
      ctx.addIssue({ code: 'custom', message: '名称与别名重复' });
  });
export type StoryElement = z.infer<typeof StoryElement>;
export const IgnoredElement = z.strictObject({ kind: ElementKind, name: ElementName });
export const StoryElementResult = StoryElement.safeExtend({
  mentions: z.number().int().nonnegative(),
  episodes: z.array(
    z.strictObject({ episodeId: ScriptId, scenes: z.number().int().nonnegative() }),
  ),
});
export const StoryResult = z.strictObject({
  revision: z.number().int().nonnegative(),
  elements: z.array(StoryElementResult),
  ignored: z.array(IgnoredElement),
});
export type StoryResult = z.infer<typeof StoryResult>;
export const StoryOccurrencesResult = z
  .array(
    z.strictObject({
      episodeId: ScriptId,
      sceneId: ScriptId,
      beatId: ScriptId.nullable(),
      excerpt: z.string().max(80),
    }),
  )
  .max(200);
export type StoryOccurrencesResult = z.infer<typeof StoryOccurrencesResult>;
export const StoryElementCreateRequest = z.strictObject({ kind: ElementKind, name: ElementName });
export type StoryElementCreateRequest = z.infer<typeof StoryElementCreateRequest>;
export const StoryElementUpdateRequest = z
  .strictObject(StoryElement.shape)
  .pick({ name: true, aliases: true, description: true, attrs: true, status: true })
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, '至少修改一个字段');
export type StoryElementUpdateRequest = z.infer<typeof StoryElementUpdateRequest>;
export const StoryElementMergeRequest = z.strictObject({
  into: ScriptId,
  attrs: ElementAttrs.optional(),
  description: z.string().max(2000).optional(),
});
export type StoryElementMergeRequest = z.infer<typeof StoryElementMergeRequest>;
export const StoryRestoreRequest = IgnoredElement;
export type StoryRestoreRequest = z.infer<typeof StoryRestoreRequest>;
export const StoryBatchRequest = z.strictObject({
  ids: z.array(ScriptId).max(500),
  action: z.enum(['confirm', 'ignore']),
});
export type StoryBatchRequest = z.infer<typeof StoryBatchRequest>;
