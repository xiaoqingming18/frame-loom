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

it('厂商头、URL 签名与动态登记的密钥在正文、对象和堆栈中脱敏', () => {
  const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  const logger = new EngineLogger('session-token', 'master-key');
  logger.registerSecret('runtime-secret');
  logger.registerSecret('');
  for (const header of ['x-api-key', 'api-key', 'x-goog-api-key']) {
    logger.log({ headers: { [header]: `object-${header}` } });
    logger.warn(`${header.toUpperCase()}: plain-${header}`);
    logger.error('请求失败', `Error: {"${header}":"stack-${header}"}`);
  }
  const params = [
    'key',
    'X-Amz-Signature',
    'X-Amz-Credential',
    'X-Amz-Security-Token',
    'OSSAccessKeyId',
    'Signature',
    'security-token',
    'x-oss-signature',
    'x-oss-credential',
    'q-signature',
    'q-ak',
    'q-key-time',
  ];
  logger.log(`https://example.com/?${params.map((key) => `${key}=secret-${key}`).join('&')}`);
  logger.error('失败 runtime-secret', 'Error: session-token master-key runtime-secret');
  const output = stderr.mock.calls.map(([chunk]) => String(chunk)).join('');
  for (const secret of [
    'session-token',
    'master-key',
    'runtime-secret',
    ...params.map((key) => `secret-${key}`),
    ...['x-api-key', 'api-key', 'x-goog-api-key'].flatMap((key) => [
      `object-${key}`,
      `plain-${key}`,
      `stack-${key}`,
    ]),
  ]) {
    expect(output).not.toContain(secret);
  }
  expect(output).toContain('example.com');
  expect(output).toContain('[REDACTED]');
});
