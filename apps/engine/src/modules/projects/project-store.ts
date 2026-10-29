import type {
  ProjectManifest,
  ProjectPageFile,
  ScriptFile,
  StoryFile,
} from '@frame-loom/contracts';

export abstract class ProjectStore {
  abstract serial<T>(projectId: string, operation: () => Promise<T> | T): Promise<T>;
  abstract readManifest(rootPath: string): Promise<ProjectManifest>;
  abstract writeManifest(rootPath: string, manifest: ProjectManifest): Promise<void>;
  abstract readPage(rootPath: string, pageId: string, saving?: boolean): Promise<ProjectPageFile>;
  abstract writePage(rootPath: string, page: ProjectPageFile): Promise<void>;
  abstract trashPage(rootPath: string, pageId: string): Promise<string>;
  abstract restorePage(rootPath: string, pageId: string, trashName: string): Promise<void>;
  abstract readScript(rootPath: string, episodeId: string, saving?: boolean): Promise<ScriptFile>;
  abstract writeScript(rootPath: string, script: ScriptFile): Promise<void>;
  abstract trashScript(rootPath: string, episodeId: string): Promise<string>;
  abstract restoreScript(rootPath: string, episodeId: string, trashName: string): Promise<void>;
  abstract readStory(rootPath: string): Promise<StoryFile>;
  abstract writeStory(rootPath: string, story: StoryFile): Promise<void>;
}
