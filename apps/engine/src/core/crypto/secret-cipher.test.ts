import { resolve } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { EngineConfig } from '../config/config.js';
import { EngineLogger } from '../logging/engine-logger.js';
import { SecretCipher } from './secret-cipher.js';

const key = 'ab'.repeat(32);
const config = (secretKey = key) => new EngineConfig('token', resolve('.'), [], secretKey);

afterEach(() => vi.restoreAllMocks());

it('AES-GCM 往返、随机 IV，格式为 12 字节 IV、16 字节 tag 和密文', () => {
  const cipher = new SecretCipher(config(), new EngineLogger('token'));
  const secret = 'sk-中文-secret';
  const encrypted = cipher.encrypt(secret, 'channels', 'one');
  expect(encrypted.length).toBe(28 + Buffer.byteLength(secret));
  expect(encrypted.includes(Buffer.from(secret))).toBe(false);
  expect(cipher.decrypt(encrypted, 'channels', 'one')).toBe(secret);
  expect(cipher.encrypt(secret, 'channels', 'one')).not.toEqual(encrypted);
});

it('调换行、表、主密钥，篡改 IV、tag 或密文，截断密文均拒绝解密', () => {
  const cipher = new SecretCipher(config(), new EngineLogger('token'));
  const encrypted = cipher.encrypt('private-key', 'channels', 'one');
  for (const [table, row] of [
    ['channels', 'two'],
    ['object_storage_config', 'one'],
  ]) {
    expect(() => cipher.decrypt(encrypted, table, row)).toThrow(/重新填写/);
  }
  for (const offset of [0, 12, 28]) {
    const damaged = Buffer.from(encrypted);
    damaged[offset] ^= 1;
    expect(() => cipher.decrypt(damaged, 'channels', 'one')).toThrow(/重新填写/);
  }
  expect(() => cipher.decrypt(encrypted.subarray(0, 20), 'channels', 'one')).toThrow();
  const changedKey = new SecretCipher(config('cd'.repeat(32)), new EngineLogger('token'));
  expect(() => changedKey.decrypt(encrypted, 'channels', 'one')).toThrow(/重新填写/);
});

it('AAD 用无歧义二元组编码，防止表名与行 ID 拼接碰撞', () => {
  const cipher = new SecretCipher(config(), new EngineLogger('token'));
  const encrypted = cipher.encrypt('secret', 'a:b', 'c');
  expect(() => cipher.decrypt(encrypted, 'a', 'b:c')).toThrow();
});

it('未配置主密钥时仍可构造服务，但加解密均返回明确错误', () => {
  const cipher = new SecretCipher(config(''), new EngineLogger('token'));
  expect(() => cipher.encrypt('secret', 'channels', 'one')).toThrow(/安全存储不可用/);
  expect(() => cipher.decrypt(Buffer.alloc(28), 'channels', 'one')).toThrow(/安全存储不可用/);
});

it('加解密成功时把明文登记给共享日志实例', () => {
  const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  const writer = new SecretCipher(config(), new EngineLogger('token'));
  const encrypted = writer.encrypt('secret-provider', 'channels', 'one');
  const logger = new EngineLogger('token');
  const cipher = new SecretCipher(config(), logger);
  cipher.decrypt(encrypted, 'channels', 'one');
  cipher.encrypt('another-provider', 'channels', 'two');
  logger.error('secret-provider another-provider');
  expect(stderr.mock.calls.flat().join('')).not.toMatch(/secret-provider|another-provider/);
});
