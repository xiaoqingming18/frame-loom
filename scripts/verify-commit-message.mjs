import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const cli = require.resolve('@commitlint/cli/cli.js');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function runCommitlint(args = [], { cwd = process.cwd(), input, stdio = 'pipe' } = {}) {
  // 直接启动 Node，避免 Windows 的 .cmd 与 shell 引号差异。
  const result = spawnSync(process.execPath, [cli, ...args, '--cwd', cwd, '--config', resolve(root, 'commitlint.config.mjs')], {
    cwd,
    input,
    encoding: 'utf8',
    stdio,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  return result;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const result = runCommitlint(process.argv.slice(2), { stdio: 'inherit' });
    if (result.status !== 0) console.error('提交信息未通过校验，请参考 docs/git-commit-convention.md。');
    process.exitCode = result.status ?? 1;
  } catch (error) {
    console.error(`提交信息校验失败：${error.message}`);
    process.exitCode = 1;
  }
}
