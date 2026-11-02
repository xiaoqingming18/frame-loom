import type { ProjectManifest, ProjectPageFile } from '@frame-loom/contracts';

export abstract class ProjectStore {
  abstract serial<T>(projectId: string, operation: () => Promise<T> | T): Promise<T>;
  abstract readManifest(rootPath: string): Promise<ProjectManifest>;
  abstract writeManifest(rootPath: string, manifest: ProjectManifest): Promise<void>;
  abstract readPage(rootPath: string, pageId: string, saving?: boolean): Promise<ProjectPageFile>;
  abstract writePage(rootPath: string, page: ProjectPageFile): Promise<void>;
  abstract trashPage(rootPath: string, pageId: string): Promise<string>;
  abstract restorePage(rootPath: string, pageId: string, trashName: string): Promise<void>;
}
