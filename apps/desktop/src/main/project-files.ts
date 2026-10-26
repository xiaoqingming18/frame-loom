import { lstat, readFile, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, sep } from 'node:path';
import {
  ProjectList,
  ProjectManifest,
  ProjectRevealRequest,
  type EngineConnection,
} from '@frame-loom/contracts';

export async function projectTarget(input: unknown, connection: EngineConnection): Promise<string> {
  const { projectId, path } = ProjectRevealRequest.parse(input);
  const response = await fetch(`${connection.baseUrl}/projects`, {
    headers: { Authorization: `Bearer ${connection.token}` },
    redirect: 'error',
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error('无法查询项目目录');
  const project = ProjectList.parse(await response.json()).find((item) => item.id === projectId);
  if (!project || project.status !== 'available') throw new Error('项目不可用，请重新定位');
  if ((await lstat(project.rootPath)).isSymbolicLink()) throw new Error('项目根目录不能是链接');
  const root = await realpath(project.rootPath);
  async function checked(parts: string[]) {
    let target = root;
    for (const part of parts) {
      target = join(target, part);
      if ((await lstat(target)).isSymbolicLink()) throw new Error('不能操作符号链接或 junction');
    }
    const resolved = await realpath(target);
    const offset = relative(root, resolved);
    if (offset === '..' || offset.startsWith(`..${sep}`) || isAbsolute(offset))
      throw new Error('路径超出项目目录');
    return resolved;
  }
  const manifest = ProjectManifest.parse(
    JSON.parse(await readFile(await checked(['.frameloom', 'project.json']), 'utf8')),
  );
  if (manifest.id !== projectId) throw new Error('项目 id 不匹配');
  if (path?.split('/').some((part) => part.toLowerCase().startsWith('.frameloom')))
    throw new Error('不能操作内部目录');
  return path === undefined ? root : checked(path.split('/'));
}
