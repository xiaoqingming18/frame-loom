import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { runCommitlint } from '../scripts/verify-commit-message.mjs';
import { selectCommits, verifyCommits } from '../scripts/verify-commits.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sha = 'a'.repeat(40);

test('提交规则接受中文和可选范围，拒绝不合规消息', async (t) => {
  const cases = [
    ['中文摘要', 'feat(ai): 支持参考图生成分镜草稿', true],
    ['省略范围', 'docs: 补充使用说明', true],
    ['专有名称', 'build(deps): 升级 Electron 至已验证版本', true],
    ['机器人摘要', 'build(deps): bump Electron to a verified version', true],
    ['长中文正文与尾注', `fix(media): 修复导出取消\n\n${'验证实际行为。'.repeat(30)}\n\nNote: .agents/notes/implemented/process/example.md\nRefs: #12`, true],
    ['破坏性变更', 'feat(project)!: 升级清单格式\n\nBREAKING CHANGE: 旧文件需使用转换入口迁移。', true],
    ['回退', `revert(ai): 回退不稳定的模型适配\n\n恢复已验证的模型路径。\n\nReverts: ${sha}`, true],
    ['Git 合并消息', "Merge branch 'feature/example'", true],
    ['72字符边界', `docs: ${'文'.repeat(66)}`, true],
    ['未知类型', 'feature(ai): 增加分镜能力', false],
    ['空摘要', 'fix: ', false],
    ['超长标题', `docs: ${'文'.repeat(67)}`, false],
    ['大写范围', 'fix(AI): 修复模型调用', false],
    ['多个范围', 'fix(ai,media): 修复生成任务', false],
    ['范围前后短横线', 'fix(-ai): 修复模型调用', false],
    ['两个空格', 'fix:  修复调用', false],
    ['末尾空格', 'fix: 修复调用 ', false],
    ['中文句号', 'fix: 修复调用。', false],
    ['英文句号', 'fix: 修复调用.', false],
    ['正文未空行', 'fix: 修复调用\n验证失败情况。', false],
    ['尾注未空行', 'fix: 修复调用\n\n修复状态。\nNote: .agents/notes/example.md', false],
    ['只有感叹号', 'feat(project)!: 升级清单格式', false],
    ['只有破坏性尾注', 'feat(project): 升级清单格式\n\nBREAKING CHANGE: 旧文件需要转换。', false],
    ['缺少回退目标', 'revert(ai): 回退模型适配', false],
    ['临时修正提交', 'fixup! fix: 修复调用', false],
    ['版本标签标题', 'v0.1.0', false],
  ];
  for (const [name, message, valid] of cases) {
    await t.test(name, () => {
      const result = runCommitlint([], { cwd: root, input: message });
      assert.equal(result.status === 0, valid, `${result.stdout}${result.stderr}`);
    });
  }
});

test('真实 Git 钩子阻止错误提交，范围检查覆盖根提交及每条新增提交', () => {
  // 测试仓库位于依赖缓存内，复用已锁定依赖，不修改当前仓库的历史和索引。
  const cache = join(root, 'node_modules', '.cache');
  mkdirSync(cache, { recursive: true });
  const fixture = mkdtempSync(join(cache, 'commit-convention-'));
  const emptyGitConfig = join(fixture, 'empty.gitconfig');
  writeFileSync(emptyGitConfig, '');
  const env = { ...process.env, CI: '', HUSKY: '1', NODE_ENV: 'development', GIT_CONFIG_GLOBAL: emptyGitConfig, GIT_CONFIG_NOSYSTEM: '1' };
  for (const name of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE']) delete env[name];
  const run = (command, args, extra = {}) => spawnSync(command, args, { cwd: fixture, env, encoding: 'utf8', windowsHide: true, ...extra });
  const git = (...args) => {
    const result = run('git', args);
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
    return result.stdout.trim();
  };
  try {
    for (const file of ['package.json', 'commitlint.config.mjs', '.gitmessage.txt', '.husky/commit-msg', 'scripts/setup-git.mjs', 'scripts/verify-commit-message.mjs']) {
      mkdirSync(dirname(join(fixture, file)), { recursive: true });
      copyFileSync(join(root, file), join(fixture, file));
    }
    git('init', '-b', 'main');
    git('config', 'user.name', 'Commit Convention Test');
    git('config', 'user.email', 'commit-convention@example.invalid');
    const setup = run(process.execPath, ['scripts/setup-git.mjs']);
    assert.equal(setup.status, 0, `${setup.stdout}${setup.stderr}`);
    assert.equal(git('config', '--local', '--get', 'core.hooksPath'), '.husky/_');
    assert.equal(realpathSync(git('config', '--local', '--get', 'commit.template')), realpathSync(join(fixture, '.gitmessage.txt')));

    // CI 环境的准备过程不能重新写入 hooksPath。
    git('config', '--local', 'core.hooksPath', 'ci-preserve');
    const ciSetup = run(process.execPath, ['scripts/setup-git.mjs', '--hooks-only'], { env: { ...env, CI: 'true', HUSKY: '0' } });
    assert.equal(ciSetup.status, 0);
    assert.equal(git('config', '--local', '--get', 'core.hooksPath'), 'ci-preserve');
    git('config', '--local', 'core.hooksPath', '.husky/_');

    const invalid = run('git', ['commit', '--allow-empty', '-m', '错误标题']);
    assert.notEqual(invalid.status, 0);
    assert.match(`${invalid.stdout}${invalid.stderr}`, /提交信息未通过校验/u);
    assert.notEqual(run('git', ['rev-parse', '--verify', 'HEAD']).status, 0);

    const messageFile = join(fixture, 'message.txt');
    const message = 'docs: 补充中文说明\n\n# 模拟编辑器保留的模板注释\n';
    writeFileSync(messageFile, message);
    const check = runCommitlint(['--edit', messageFile], { cwd: fixture });
    assert.equal(check.status, 0, `${check.stdout}${check.stderr}`);
    assert.equal(readFileSync(messageFile, 'utf8'), message);
    git('commit', '--allow-empty', '-F', messageFile);
    const first = git('rev-parse', 'HEAD');
    git('commit', '--allow-empty', '-m', 'fix(ai): 修复模型调用');
    const second = git('rev-parse', 'HEAD');
    git('commit', '--allow-empty', '-m', 'test(ai): 补充取消任务测试');
    const third = git('rev-parse', 'HEAD');

    assert.deepEqual(selectCommits({ from: '0'.repeat(40), to: third, cwd: fixture }), [first, second, third]);
    assert.deepEqual(selectCommits({ from: first, to: third, cwd: fixture }), [second, third]);
    assert.deepEqual(selectCommits({ from: third, to: third, cwd: fixture }), []);
    assert.deepEqual(selectCommits({ to: '0'.repeat(40), cwd: fixture }), []);
    assert.throws(() => selectCommits({ from: 'missing-ref', cwd: fixture }));
    verifyCommits({ from: first, to: third, cwd: fixture });

    // 模拟他人绕过本地钩子，CI 仍须发现位于范围中间的错误消息。
    git('-c', 'core.hooksPath=disabled-for-test', 'commit', '--allow-empty', '-m', '错误标题');
    git('commit', '--allow-empty', '-m', 'docs: 补充后续说明');
    assert.throws(() => verifyCommits({ from: third, to: 'HEAD', cwd: fixture }), /1\/2/u);
  } finally {
    // 删除前核对解析后的绝对路径严格位于本测试的缓存目录内。
    const cacheRoot = realpathSync(cache);
    const fixtureRoot = realpathSync(fixture);
    const child = relative(cacheRoot, fixtureRoot);
    assert.ok(child && !child.startsWith('..') && !isAbsolute(child));
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});
