import { z } from 'zod';
import { CanvasDocument, CanvasSaveResult, CanvasView } from './canvas.js';
import { Sha256 } from './generation.js';

export const ProjectId = z.string().uuid();
export const ProjectPageId = z.string().uuid();

export function validateEntryName(name: string): string | null {
  if (!name.trim() || [...name].length > 80) return '名称须为 1–80 个字符';
  if (/[<>:"/\\|?*\u0000-\u001f\u007f-\u009f]/u.test(name)) return '名称不能包含特殊字符或控制字符';
  if (/[. ]$/u.test(name)) return '名称不能以点或空格结尾';
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(name))
    return '名称不能使用 Windows 保留名';
  return null;
}

export const EntryName = z.string().superRefine((name, ctx) => {
  const message = validateEntryName(name);
  if (message) ctx.addIssue({ code: 'custom', message });
});
// 表单先去掉首尾空白；磁盘文件名与资产路径必须逐字校验，不能悄悄改名。
export const ProjectName = z.string().trim().pipe(EntryName);
export const AssetPath = z
  .string()
  .max(4096)
  .refine((path) => {
    if (!path || path.includes('\\') || path.startsWith('/') || path.includes(':')) return false;
    const parts = path.split('/');
    return (
      !parts[0].toLowerCase().startsWith('.frameloom') &&
      parts.every((part) => part !== '.' && part !== '..' && validateEntryName(part) === null)
    );
  }, '资产路径必须是安全的相对路径，不能访问内部目录');
export const AssetDirectoryPath = z.union([z.literal(''), AssetPath]);

const Timestamp = z.string().datetime();
const FormatVersion = z.number().int().positive().max(1, 'PROJECT_FORMAT_TOO_NEW：需要更新应用');
export const ProjectPageSummary = z
  .object({
    id: ProjectPageId,
    name: EntryName,
    createdAt: Timestamp,
    updatedAt: Timestamp,
    coverSha256: Sha256.nullable(),
  })
  .passthrough();
export type ProjectPageSummary = z.infer<typeof ProjectPageSummary>;
export const ProjectManifest = z
  .object({
    format: z.literal('frame-loom-project'),
    formatVersion: FormatVersion,
    id: ProjectId,
    name: EntryName,
    createdAt: Timestamp,
    updatedAt: Timestamp,
    pages: z.array(ProjectPageSummary),
  })
  .passthrough()
  .superRefine((manifest, ctx) => {
    const ids = new Set<string>();
    const names = new Set<string>();
    for (const page of manifest.pages) {
      const name = page.name.toLowerCase();
      if (ids.has(page.id) || names.has(name))
        ctx.addIssue({ code: 'custom', message: '创作页 id 或名称重复' });
      ids.add(page.id);
      names.add(name);
    }
  });
export type ProjectManifest = z.infer<typeof ProjectManifest>;
export const ProjectPageFile = z
  .object({
    format: z.literal('frame-loom-page'),
    formatVersion: FormatVersion,
    id: ProjectPageId,
    revision: z.number().int().positive(),
    document: CanvasDocument,
  })
  .passthrough();
export type ProjectPageFile = z.infer<typeof ProjectPageFile>;
export const ProjectStatus = z.enum(['available', 'missing', 'mismatch', 'unreadable', 'too_new']);
export type ProjectStatus = z.infer<typeof ProjectStatus>;
export const ProjectSummary = z.strictObject({
  id: ProjectId,
  name: EntryName,
  rootPath: z.string().min(1),
  locationKind: z.literal('local'),
  remoteId: z.string().nullable(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
  addedAt: Timestamp,
  lastOpenedAt: Timestamp,
  status: ProjectStatus,
});
export type ProjectSummary = z.infer<typeof ProjectSummary>;
export const ProjectList = z.array(ProjectSummary);
export type ProjectList = z.infer<typeof ProjectList>;
export const ProjectCreateRequest = z.strictObject({
  name: ProjectName,
  location: z.string().min(1).max(4096),
});
export type ProjectCreateRequest = z.infer<typeof ProjectCreateRequest>;
export const ProjectOpenRequest = z.strictObject({
  rootPath: z.string().min(1).max(4096),
  asCopy: z.boolean().default(false),
  name: ProjectName.optional(),
});
export type ProjectOpenRequest = z.infer<typeof ProjectOpenRequest>;
export const ProjectRelocateRequest = z.strictObject({ rootPath: z.string().min(1).max(4096) });
export type ProjectRelocateRequest = z.infer<typeof ProjectRelocateRequest>;
export const ProjectRenameRequest = z.strictObject({ name: ProjectName });
export type ProjectRenameRequest = z.infer<typeof ProjectRenameRequest>;
export const ProjectPageCreateRequest = ProjectRenameRequest;
export type ProjectPageCreateRequest = z.infer<typeof ProjectPageCreateRequest>;
export const ProjectPageRenameRequest = ProjectRenameRequest;
export type ProjectPageRenameRequest = z.infer<typeof ProjectPageRenameRequest>;
export const ProjectPageSaveRequest = z.strictObject({
  revision: z.number().int().positive(),
  document: CanvasDocument,
});
export type ProjectPageSaveRequest = z.infer<typeof ProjectPageSaveRequest>;
export const ProjectPageSaveResult = CanvasSaveResult.extend({ missing: z.array(Sha256) });
export type ProjectPageSaveResult = z.infer<typeof ProjectPageSaveResult>;
export const ProjectPageRecord = ProjectPageFile.extend({ view: CanvasView.nullable() });
export type ProjectPageRecord = z.infer<typeof ProjectPageRecord>;
export const ProjectPageViewRequest = CanvasView;
export type ProjectPageViewRequest = z.infer<typeof ProjectPageViewRequest>;
export const ProjectMutationResult = z.strictObject({ saved: z.literal(true) });
export type ProjectMutationResult = z.infer<typeof ProjectMutationResult>;

export const AssetEntry = z.strictObject({
  name: z.string().min(1),
  path: AssetPath,
  type: z.enum(['file', 'directory']),
  bytes: z.number().int().nonnegative(),
  updatedAt: Timestamp,
  mediaKind: z.enum(['image', 'video', 'audio']).nullable(),
});
export type AssetEntry = z.infer<typeof AssetEntry>;
export const AssetListRequest = z.strictObject({ path: AssetDirectoryPath.default('') });
export type AssetListRequest = z.infer<typeof AssetListRequest>;
export const AssetListResult = z.array(AssetEntry);
export type AssetListResult = z.infer<typeof AssetListResult>;
export const AssetSearchRequest = z.strictObject({ query: z.string().trim().min(1).max(200) });
export type AssetSearchRequest = z.infer<typeof AssetSearchRequest>;
export const AssetSearchResult = z.strictObject({
  entries: z.array(AssetEntry),
  truncated: z.boolean(),
});
export type AssetSearchResult = z.infer<typeof AssetSearchResult>;
export const AssetCreateDirectoryRequest = z.strictObject({
  path: AssetDirectoryPath,
  name: EntryName,
});
export type AssetCreateDirectoryRequest = z.infer<typeof AssetCreateDirectoryRequest>;
export const AssetUploadRequest = z.strictObject({ path: AssetDirectoryPath, name: EntryName });
export type AssetUploadRequest = z.infer<typeof AssetUploadRequest>;
export const AssetRenameRequest = z.strictObject({ path: AssetPath, name: EntryName });
export type AssetRenameRequest = z.infer<typeof AssetRenameRequest>;
export const AssetMoveRequest = z.strictObject({
  path: AssetPath,
  destination: AssetDirectoryPath,
});
export type AssetMoveRequest = z.infer<typeof AssetMoveRequest>;
export const AssetDeleteRequest = z.strictObject({ path: AssetPath });
export type AssetDeleteRequest = z.infer<typeof AssetDeleteRequest>;
export const AssetImportRequest = z.strictObject({ path: AssetPath });
export type AssetImportRequest = z.infer<typeof AssetImportRequest>;
export const AssetExportRequest = z.strictObject({
  sha256: Sha256,
  path: AssetDirectoryPath,
  name: EntryName,
});
export type AssetExportRequest = z.infer<typeof AssetExportRequest>;
