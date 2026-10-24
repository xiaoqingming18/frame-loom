const headerPattern = /^[a-z]+(?:\([a-z]+(?:-[a-z]+)*\))?!?: \S(?:.*\S)?$/u;
const footerPattern = /^(?:BREAKING[ -]CHANGE|[A-Za-z][A-Za-z-]*):\s+\S|^(?:Refs|Closes|Fixes) #\d+/u;

export default {
  extends: ['@commitlint/config-conventional'],
  // 只豁免 Git 默认合并消息，避免默认忽略规则放过 fixup 和版本标题。
  defaultIgnores: false,
  ignores: [(message) => /^Merge (?:branch |branches |pull request |remote-tracking branch |tag )/u.test(message)],
  helpUrl: 'https://www.conventionalcommits.org/zh-hans/v1.0.0/',
  plugins: [{
    rules: {
      'frame-loom-header': ({ header = '' }) => [
        headerPattern.test(header) && !/[.。]$/u.test(header),
        '标题使用 type(scope): 中文摘要；范围可省略，仅允许小写英文与短横线，冒号后一个空格，末尾不加句号',
      ],
      'frame-loom-footer-spacing': ({ raw = '' }) => {
        const lines = raw.replace(/\r\n?/gu, '\n').split('\n');
        const firstFooter = lines.findIndex((line, index) => index > 0 && footerPattern.test(line));
        return [
          firstFooter < 0 || lines[firstFooter - 1].trim() === '',
          '第一条尾注与标题或正文之间必须留空行',
        ];
      },
      'frame-loom-revert': ({ type, raw = '' }) => [
        type !== 'revert' || /^Reverts: (?:[a-f0-9]{40}|[a-f0-9]{64})$/mu.test(raw),
        '回退提交必须填写 Reverts: <完整提交 SHA>',
      ],
    },
  }],
  rules: {
    'type-enum': [2, 'always', ['feat', 'fix', 'perf', 'refactor', 'docs', 'test', 'build', 'ci', 'style', 'chore', 'revert']],
    'type-case': [2, 'always', 'lower-case'],
    'scope-case': [2, 'always', 'lower-case'],
    'header-max-length': [2, 'always', 72],
    'header-trim': [2, 'always'],
    'subject-case': [0],
    'body-leading-blank': [2, 'always'],
    'footer-leading-blank': [2, 'always'],
    // 中文正文及完整路径不沿用上游的英文百列限制。
    'body-max-line-length': [0],
    'footer-max-line-length': [0],
    'breaking-change-exclamation-mark': [2, 'always'],
    'frame-loom-header': [2, 'always'],
    'frame-loom-footer-spacing': [2, 'always'],
    'frame-loom-revert': [2, 'always'],
  },
};
