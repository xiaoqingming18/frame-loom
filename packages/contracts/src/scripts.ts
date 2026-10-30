import { z } from 'zod';
import { EpisodeSummary, ProjectProfile } from './projects.js';

export const BLOCK_TYPES = [
  'act',
  'scene',
  'cast',
  'action',
  'character',
  'parenthetical',
  'dialogue',
  'sound',
  'production',
  'text',
  'transition',
  'note',
] as const;
export const BlockType = z.enum(BLOCK_TYPES);
export type BlockType = z.infer<typeof BlockType>;
export const BLOCK_LABELS: Record<BlockType, string> = {
  act: '幕',
  scene: '场标题',
  cast: '出场人物',
  action: '动作',
  character: '角色',
  parenthetical: '括注',
  dialogue: '对白',
  sound: '音效／音乐',
  production: '制作提示',
  text: '字幕／画面文字',
  transition: '转场',
  note: '注释',
};
export const BLOCK_SHORT_LABELS: Record<BlockType, string> = {
  act: '幕',
  scene: '场',
  cast: '人',
  action: '动',
  character: '角',
  parenthetical: '括',
  dialogue: '白',
  sound: '音',
  production: '制',
  text: '字',
  transition: '转',
  note: '注',
};
export const BlockId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
export const SceneTime = z.enum(['day', 'night', 'dawn', 'dusk']);
export type SceneTime = z.infer<typeof SceneTime>;
export const SceneSpace = z.enum(['int', 'ext', 'intext']);
export const SceneAttrs = z.strictObject({
  time: SceneTime.nullable(),
  space: SceneSpace.nullable(),
  timeText: z.string().max(20).nullable(),
  note: z.string().max(40).nullable(),
  timecode: z.string().max(40).nullable(),
});
export type SceneAttrs = z.infer<typeof SceneAttrs>;
export const CharacterAttrs = z.strictObject({
  delivery: z.enum(['vo', 'os', 'inner']).nullable(),
  extension: z.string().max(80).nullable(),
});
export type CharacterAttrs = z.infer<typeof CharacterAttrs>;
export const TagAttrs = z.strictObject({ label: z.string().min(1).max(8) });
export type TagAttrs = z.infer<typeof TagAttrs>;
const BlockText = z
  .string()
  .max(4000)
  .refine((text) => !/[\r\n]/u.test(text), '段落文字不能含换行');
export const ReviewOption = z.strictObject({
  type: BlockType,
  character: z.string().max(40).optional(),
  text: BlockText.optional(),
});
export type ReviewOption = z.infer<typeof ReviewOption>;
export const ScriptBlock = z
  .strictObject({
    id: BlockId,
    type: BlockType,
    text: BlockText,
    attrs: z.union([SceneAttrs, CharacterAttrs, TagAttrs]).optional(),
    src: z.strictObject({ line: z.number().int().nonnegative() }).optional(),
    review: z
      .strictObject({ reason: z.string().max(200), options: z.array(ReviewOption).min(1).max(4) })
      .optional(),
  })
  .superRefine((block, ctx) => {
    if (
      !(
        block.type === 'scene'
          ? SceneAttrs
          : block.type === 'character'
            ? CharacterAttrs
            : block.type === 'sound' || block.type === 'production'
              ? TagAttrs
              : z.undefined()
      ).safeParse(block.attrs).success
    )
      ctx.addIssue({ code: 'custom', message: 'attrs 与段落类型不匹配' });
  });
export type ScriptBlock = z.infer<typeof ScriptBlock>;
const LegacyBlock = z
  .strictObject({
    ...ScriptBlock.shape,
    type: z.enum(BLOCK_TYPES.filter((type) => type !== 'production')),
    attrs: z
      .union([
        SceneAttrs.pick({ time: true, space: true }),
        CharacterAttrs.pick({ delivery: true }),
      ])
      .optional(),
  })
  .superRefine((block, ctx) => {
    if (
      block.attrs !== undefined &&
      !(
        block.type === 'scene'
          ? SceneAttrs.pick({ time: true, space: true })
          : block.type === 'character'
            ? CharacterAttrs.pick({ delivery: true })
            : z.never()
      ).safeParse(block.attrs).success
    )
      ctx.addIssue({ code: 'custom', message: 'attrs 与段落类型不匹配' });
  });
const DocumentV2 = z.strictObject({
  schemaVersion: z.literal(2),
  preface: z.string().max(50000),
  appendix: z.string().max(50000),
  blocks: z.array(ScriptBlock).max(5000),
});
export const ScriptDocument = z
  .union([
    DocumentV2,
    z
      .strictObject({ schemaVersion: z.literal(1), blocks: z.array(LegacyBlock).max(5000) })
      .transform((doc): z.input<typeof DocumentV2> => ({
        schemaVersion: 2 as const,
        preface: '',
        appendix: '',
        blocks: doc.blocks.map(({ attrs, ...block }) => ({
          ...block,
          ...(block.type === 'scene'
            ? {
                attrs: {
                  time: null,
                  space: null,
                  ...attrs,
                  timeText: null,
                  note: null,
                  timecode: null,
                },
              }
            : block.type === 'character'
              ? { attrs: { delivery: null, ...attrs, extension: null } }
              : block.type === 'sound'
                ? { attrs: { label: '音效' } }
                : {}),
        })),
      }))
      .pipe(DocumentV2),
  ])
  .refine(
    (doc) => new Set(doc.blocks.map((block) => block.id)).size === doc.blocks.length,
    '段落 id 重复',
  );
export type ScriptDocument = z.infer<typeof ScriptDocument>;
export const ScriptSource = z.strictObject({
  text: z.string().min(1).max(200000),
  importedAt: z.string().datetime(),
});
export type ScriptSource = z.infer<typeof ScriptSource>;
export const ScriptFile = z
  .object({
    format: z.literal('frame-loom-script'),
    formatVersion: z.literal(1),
    id: z.string().uuid(),
    revision: z.number().int().positive(),
    source: ScriptSource.nullable(),
    pendingImport: ScriptSource.nullable(),
    convertedAt: z.string().datetime().nullable(),
    document: ScriptDocument,
  })
  .passthrough()
  .refine(
    (file) => new TextEncoder().encode(JSON.stringify(file)).byteLength <= 4 * 1024 * 1024,
    '剧本文件不能超过 4 MiB',
  );
export type ScriptFile = z.infer<typeof ScriptFile>;
export const ElementKind = z.enum(['character', 'location', 'prop', 'costume']);
export type ElementKind = z.infer<typeof ElementKind>;
export const ElementName = z.string().trim().min(1).max(40);
const ElementAttrs = z.strictObject({
  gender: z.string().max(200).optional(),
  ageRange: z.string().max(200).optional(),
  appearance: z.string().max(200).optional(),
  personality: z.string().max(200).optional(),
  space: SceneSpace.optional(),
  times: z.array(SceneTime).optional(),
});
export const StoryElement = z.strictObject({
  id: z.string().uuid(),
  kind: ElementKind,
  name: ElementName,
  aliases: z.array(ElementName).max(20),
  status: z.enum(['pending', 'confirmed']),
  description: z.string().max(2000),
  attrs: ElementAttrs,
  suggestedMergeInto: z.string().uuid().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type StoryElement = z.infer<typeof StoryElement>;
export const IgnoredElement = z.strictObject({ kind: ElementKind, name: ElementName });
export const StoryFile = z
  .object({
    format: z.literal('frame-loom-story'),
    formatVersion: z.literal(1),
    revision: z.number().int().nonnegative(),
    elements: z.array(StoryElement).max(2000),
    ignored: z.array(IgnoredElement).max(2000),
  })
  .passthrough()
  .superRefine((story, ctx) => {
    const terms = new Set<string>();
    const ids = new Set<string>();
    for (const element of story.elements) {
      if (ids.has(element.id)) ctx.addIssue({ code: 'custom', message: '元素 id 重复' });
      ids.add(element.id);
      for (const name of [element.name, ...element.aliases]) {
        const key = `${element.kind}:${name.toLowerCase()}`;
        if (terms.has(key)) ctx.addIssue({ code: 'custom', message: '同类元素名称或别名重复' });
        terms.add(key);
      }
    }
  });
export type StoryFile = z.infer<typeof StoryFile>;
export const ConversionState = z.strictObject({
  status: z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled']),
  stage: z.enum(['split', 'classify', 'extract', 'match']).nullable(),
  done: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  warnings: z.array(z.string()),
  error: z.string().nullable(),
  result: z
    .strictObject({
      scenes: z.number().int().nonnegative(),
      blocks: z.number().int().nonnegative(),
      unsure: z.number().int().nonnegative(),
      addedElements: z.number().int().nonnegative(),
    })
    .nullable(),
});
export type ConversionState = z.infer<typeof ConversionState>;
export const EpisodeCreateRequest = EpisodeSummary.pick({ number: true, title: true });
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
export const ScriptResult = ScriptFile.safeExtend({ conversion: ConversionState.nullable() });
export type ScriptResult = z.infer<typeof ScriptResult>;
export const ScriptSaveRequest = z.strictObject({
  revision: z.number().int().positive(),
  document: ScriptDocument,
});
export type ScriptSaveRequest = z.infer<typeof ScriptSaveRequest>;
export const ScriptSaveResult = z.strictObject({
  revision: z.number().int().positive(),
  addedElements: z.number().int().nonnegative(),
});
export type ScriptSaveResult = z.infer<typeof ScriptSaveResult>;
export const ScriptImportRequest = z.strictObject({
  revision: z.number().int().positive(),
  text: ScriptSource.shape.text.optional(),
  profile: ProjectProfile.optional(),
});
export type ScriptImportRequest = z.infer<typeof ScriptImportRequest>;
export const ScriptImportResult = z.strictObject({
  revision: z.number().int().positive(),
  conversion: ConversionState,
});
export type ScriptImportResult = z.infer<typeof ScriptImportResult>;
export const StoryElementResult = StoryElement.extend({
  mentions: z.number().int().nonnegative(),
  episodes: z.array(
    z.strictObject({ episodeId: z.string().uuid(), scenes: z.number().int().nonnegative() }),
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
      episodeId: z.string().uuid(),
      blockId: BlockId,
      sceneId: BlockId.nullable(),
      excerpt: z.string().max(80),
    }),
  )
  .max(200);
export type StoryOccurrencesResult = z.infer<typeof StoryOccurrencesResult>;
export const StoryElementCreateRequest = StoryElement.pick({ kind: true, name: true });
export type StoryElementCreateRequest = z.infer<typeof StoryElementCreateRequest>;
export const StoryElementUpdateRequest = StoryElement.pick({
  name: true,
  aliases: true,
  description: true,
  attrs: true,
  status: true,
})
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, '至少修改一个字段');
export type StoryElementUpdateRequest = z.infer<typeof StoryElementUpdateRequest>;
export const StoryElementMergeRequest = z.strictObject({ into: z.string().uuid() });
export type StoryElementMergeRequest = z.infer<typeof StoryElementMergeRequest>;
export const StoryRestoreRequest = IgnoredElement;
export type StoryRestoreRequest = z.infer<typeof StoryRestoreRequest>;
export const StoryBatchRequest = z.strictObject({
  ids: z.array(z.string().uuid()).max(500),
  action: z.enum(['confirm', 'ignore']),
});
export type StoryBatchRequest = z.infer<typeof StoryBatchRequest>;
