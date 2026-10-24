import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { runCommitlint } from './verify-commit-message.mjs';

function git(args, cwd, trim = true) {
  const output = execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return trim ? output.trim() : output;
}

export function selectCommits({ from = '', to = 'HEAD', cwd = process.cwd() } = {}) {
  if (/^0+$/u.test(to)) return [];
  // 将外部传入的引用解析为提交，未知基线必须报错，不能静默漏检。
  const head = git(['rev-parse', '--verify', '--end-of-options', `${to}^{commit}`], cwd);
  const base = !from || /^0+$/u.test(from)
    ? null
    : git(['rev-parse', '--verify', '--end-of-options', `${from}^{commit}`], cwd);
  const commits = git(['rev-list', '--reverse', base ? `${base}..${head}` : head], cwd);
  return commits ? commits.split('\n') : [];
}

export function verifyCommits(options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const commits = selectCommits({ ...options, cwd });
  let failures = 0;
  for (const sha of commits) {
    const message = git(['show', '-s', '--format=%B', sha], cwd, false);
    const result = runCommitlint([], { cwd, input: message });
    if (result.status !== 0) {
      failures++;
      console.error(`提交 ${sha} 未通过校验：\n${result.stdout}${result.stderr}`);
    }
  }
  if (failures) throw new Error(`${failures}/${commits.length} 个提交信息不符合规范。`);
  console.log(`提交信息校验通过：共 ${commits.length} 个提交。`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const { values } = parseArgs({ options: { from: { type: 'string' }, to: { type: 'string' } } });
    verifyCommits({
      from: values.from ?? process.env.COMMIT_BASE ?? '',
      to: values.to ?? process.env.COMMIT_HEAD ?? 'HEAD',
    });
  } catch (error) {
    console.error(`提交范围校验失败：${error.message}`);
    process.exitCode = 1;
  }
}
