import { execFileSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';

const hooksOnly = process.argv.includes('--hooks-only');

try {
  // CI、生产依赖安装及显式禁用场景不修改本地 Git 配置。
  if (process.env.CI || process.env.NODE_ENV === 'production' || process.env.HUSKY === '0') {
    console.log('已跳过 Git 配置：当前为 CI、生产环境或 HUSKY=0。');
  } else if (!existsSync('.git') && hooksOnly) {
    console.log('已跳过 Git 钩子：当前目录没有 .git。');
  } else {
    const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
    if (realpathSync(root) !== realpathSync(process.cwd())) {
      throw new Error('请在仓库根目录运行 Git 配置命令。');
    }
    const { default: husky } = await import('husky');
    const error = husky();
    if (error) throw new Error(error);
    if (!hooksOnly) {
      execFileSync('git', ['config', '--local', 'commit.template', resolve('.gitmessage.txt')]);
    }
    console.log(hooksOnly ? '提交信息钩子已启用。' : '提交信息钩子与消息模板已配置到当前仓库。');
  }
} catch (error) {
  console.error(`Git 配置失败：${error.message}`);
  process.exitCode = 1;
}
