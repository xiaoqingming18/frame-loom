import { afterEach, expect, it, vi } from 'vitest';
import { EngineLogger } from './engine-logger.js';

afterEach(() => vi.restoreAllMocks());

it('默认只开启 error、warn、log', () => {
  const logger = new EngineLogger('secret');
  expect((['error', 'warn', 'log'] as const).map((level) => logger.isLevelEnabled(level))).toEqual([
    true,
    true,
    true,
  ]);
  expect(logger.isLevelEnabled('debug')).toBe(false);
  expect(logger.isLevelEnabled('verbose')).toBe(false);
});

it('所有级别写 stderr，消息、对象、堆栈中的令牌与认证头均脱敏', () => {
  const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  const token = 'ab'.repeat(32);
  const logger = new EngineLogger(token);
  logger.setLogLevels(['error', 'warn', 'log', 'debug', 'verbose', 'fatal']);
  logger.log(`令牌 ${token}`);
  logger.warn({ token: 'object-secret', headers: { Authorization: 'Basic header-secret' } });
  logger.error('模拟错误', `Error: Bearer ${token}\n at 模拟堆栈`);
  logger.debug('debug 消息');
  logger.verbose('verbose 消息');
  logger.fatal('fatal 消息');
  logger.error('没有堆栈的错误');
  logger.log('Authorization: Basic plain-header-secret');
  const output = stderr.mock.calls.map(([chunk]) => String(chunk)).join('');
  expect(stdout).not.toHaveBeenCalled();
  expect(output).toContain('模拟堆栈');
  expect(output).toContain('[REDACTED]');
  for (const secret of [token, 'object-secret', 'header-secret', 'plain-header-secret']) {
    expect(output).not.toContain(secret);
  }
  for (const level of ['LOG', 'WARN', 'ERROR', 'DEBUG', 'VERBOSE', 'FATAL']) {
    expect(output).toContain(level);
  }
});
