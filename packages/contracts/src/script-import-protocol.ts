import { z } from 'zod';
import { ScriptScene } from './scripts.js';

// 来源编号从零开始，end 不包含；只按容量切片，不推断剧本语义。
export const SourceRange = z
  .strictObject({ start: z.number().int().nonnegative(), end: z.number().int().positive() })
  .refine((range) => range.end > range.start, '来源区间必须非空');
export type SourceRange = z.infer<typeof SourceRange>;
export const SourceUnit = z.strictObject({ id: z.number().int().nonnegative(), text: z.string() });
export type SourceUnit = z.infer<typeof SourceUnit>;
export const ImportBoundary = z
  .strictObject({
    range: SourceRange,
    kind: z.enum(['meta', 'scene', 'unrepresentable']),
    sceneKey: z.number().int().nonnegative().nullable(),
    continuation: z.boolean(),
    reason: z.string(),
  })
  .superRefine((part, ctx) => {
    if (
      (part.kind === 'scene') !== (part.sceneKey !== null) ||
      (part.continuation && part.kind !== 'scene')
    )
      ctx.addIssue({ code: 'custom', message: '续场身份无效' });
    if (part.kind === 'scene' && !part.continuation && part.sceneKey !== part.range.start)
      ctx.addIssue({ code: 'custom', message: '新场身份必须取首来源编号' });
  });
export const ImportBoundaryBatch = z
  .strictObject({
    batchId: z.string().min(1),
    responsible: SourceRange,
    context: SourceRange,
    parts: z.array(ImportBoundary).min(1),
  })
  .superRefine((batch, ctx) => {
    if (batch.context.start > batch.responsible.start || batch.context.end < batch.responsible.end)
      ctx.addIssue({ code: 'custom', message: '上下文必须包含负责区间' });
    let cursor = batch.responsible.start;
    for (const part of batch.parts) {
      if (part.range.start !== cursor || part.range.end > batch.responsible.end)
        ctx.addIssue({ code: 'custom', message: '来源区间遗漏、重叠或越界' });
      cursor = part.range.end;
    }
    if (cursor !== batch.responsible.end)
      ctx.addIssue({ code: 'custom', message: '来源覆盖不完整' });
  });
export type ImportBoundaryBatch = z.infer<typeof ImportBoundaryBatch>;
export const SourceMapping = z
  .strictObject({
    unit: z.number().int().nonnegative(),
    start: z.number().int().nonnegative(),
    end: z.number().int().positive(),
    path: z.string().min(1),
  })
  .refine((mapping) => mapping.end > mapping.start, '字段来源必须非空');
export type SourceMapping = z.infer<typeof SourceMapping>;
export const ImportSceneBatch = z.strictObject({
  batchId: z.string().min(1),
  responsible: SourceRange,
  sceneKey: z.number().int().nonnegative(),
  continuation: z.boolean(),
  firstBeatContinuation: z.boolean().optional(),
  scene: ScriptScene.omit({ scene_id: true }),
  mappings: z.array(SourceMapping),
});
export type ImportSceneBatch = z.infer<typeof ImportSceneBatch>;
export const ImportMetaBatch = z.strictObject({
  batchId: z.string().min(1),
  responsible: SourceRange,
  core_conflict: z.string(),
  hook_start: z.string(),
  hook_end: z.string(),
  source_authority: z
    .strictObject({
      series: z.string().optional(),
      episode: z.string().optional(),
      title: z.string().optional(),
      genre: z.string().optional(),
      style: z.string().optional(),
      duration_sec: z.string().optional(),
    })
    .optional(),
  mappings: z.array(SourceMapping),
});
export type ImportMetaBatch = z.infer<typeof ImportMetaBatch>;
