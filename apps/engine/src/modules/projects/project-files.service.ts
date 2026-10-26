import { Injectable } from '@nestjs/common';
import { ProjectId, AssetDirectoryPath } from '@frame-loom/contracts';
import { eq } from 'drizzle-orm';
import fs from 'node:fs/promises';
import { isAbsolute, join, relative, sep } from 'node:path';
import { DatabaseService } from '../../core/database/database.service.js';
import { DomainError } from '../../core/http/domain-error.js';
import { ProjectStore } from './project-store.js';
import { projects } from './projects.schema.js';
import { errorCode } from './local-project-store.js';

@Injectable()
export class ProjectFilesService {
  constructor(
    private readonly database: DatabaseService,
    readonly store: ProjectStore,
  ) {}

  async root(id: string): Promise<string> {
    ProjectId.parse(id);
    const row = this.database.db.select().from(projects).where(eq(projects.id, id)).get();
    if (!row) throw new DomainError('PROJECT_NOT_FOUND', 404, '项目不在项目库中');
    try {
      const manifest = await this.store.readManifest(row.rootPath);
      if (manifest.id !== id) throw new Error('项目 id 不一致');
      return row.rootPath;
    } catch {
      throw new DomainError('PROJECT_UNAVAILABLE', 409, '项目不可用，请检查目录或重新定位');
    }
  }
}

export async function assetPath(root: string, path: string): Promise<string> {
  AssetDirectoryPath.parse(path);
  if ((await fs.lstat(root)).isSymbolicLink())
    throw new DomainError('PROJECT_PATH_UNSAFE', 400, '项目根目录不能是链接');
  const realRoot = await fs.realpath(root);
  let current = root;
  for (const part of path.split('/').filter(Boolean)) {
    current = join(current, part);
    try {
      const info = await fs.lstat(current);
      const real = await fs.realpath(current);
      const rel = relative(realRoot, real);
      if (
        info.isSymbolicLink() ||
        isAbsolute(rel) ||
        rel === '..' ||
        rel.startsWith(`..${sep}`) ||
        rel.split(sep).some((segment) => segment.toLowerCase().startsWith('.frameloom'))
      )
        throw new DomainError('PROJECT_PATH_UNSAFE', 400, '资产路径超出项目或指向内部目录、链接');
    } catch (error) {
      if (['EACCES', 'EPERM'].includes(errorCode(error) ?? ''))
        throw new DomainError('ASSET_ACCESS_DENIED', 403, '无法访问此资产');
      if (errorCode(error) !== 'ENOENT') throw error;
      // 新文件允许最后一段不存在，父目录仍须存在并经过检查。
      if (current !== join(root, path))
        throw new DomainError('ASSET_NOT_FOUND', 404, '资产父目录不存在');
    }
  }
  return join(root, path);
}
