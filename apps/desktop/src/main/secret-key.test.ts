import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { loadSecretKey } from './secret-key.js';

let directory: string;
const storage = {
  isAsyncEncryptionAvailable: vi.fn<() => Promise<boolean>>().mockResolvedValue(true),
  encryptStringAsync: vi
    .fn<(value: string) => Promise<Buffer>>()
    .mockResolvedValue(Buffer.from('encrypted-master-key')),
  decryptStringAsync: vi
    .fn<(value: Buffer) => Promise<{ result: string; shouldReEncrypt: boolean }>>()
    .mockResolvedValue({
      result: 'ab'.repeat(32),
      shouldReEncrypt: false,
    }),
};

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'frame-loom-secret-'));
  vi.clearAllMocks();
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

it('首次生成 32 字节主密钥，只原子保存 safeStorage 密文', async () => {
  const nested = join(directory, 'user-data');
  const result = await loadSecretKey(nested, storage);
  expect(result.key).toMatch(/^[0-9a-f]{64}$/);
  expect(storage.encryptStringAsync).toHaveBeenCalledWith(result.key);
  expect(await readFile(join(nested, 'secret-key.bin'), 'utf8')).toBe('encrypted-master-key');
  expect(existsSync(join(nested, 'secret-key.bin.tmp'))).toBe(false);
  expect(storage.decryptStringAsync).not.toHaveBeenCalled();
});

it('再次启动读取原主密钥，不重建或重复写入', async () => {
  const data = Buffer.from('existing-cipher');
  await writeFile(join(directory, 'secret-key.bin'), data);
  expect(await loadSecretKey(directory, storage)).toEqual({ key: 'ab'.repeat(32) });
  expect(storage.decryptStringAsync).toHaveBeenCalledWith(data);
  expect(storage.encryptStringAsync).not.toHaveBeenCalled();
});

it.each(['throw', 'invalid'])('无法解密或格式错误时备份并生成新密钥：%s', async (failure) => {
  const file = join(directory, 'secret-key.bin');
  await writeFile(file, 'broken-cipher');
  if (failure === 'throw') storage.decryptStringAsync.mockRejectedValueOnce(new Error('DPAPI'));
  else storage.decryptStringAsync.mockResolvedValueOnce({ result: 'bad', shouldReEncrypt: false });
  const result = await loadSecretKey(directory, storage);
  expect(result.key).toMatch(/^[0-9a-f]{64}$/);
  expect(result.warning).toContain('重新填写');
  expect(await readFile(`${file}.broken`, 'utf8')).toBe('broken-cipher');
  expect(await readFile(file, 'utf8')).toBe('encrypted-master-key');
});

it('safeStorage 不可用时返回空值和提示，不碰既有密钥文件', async () => {
  await writeFile(join(directory, 'secret-key.bin'), 'existing-cipher');
  storage.isAsyncEncryptionAvailable.mockResolvedValueOnce(false);
  const result = await loadSecretKey(directory, storage);
  expect(result.key).toBe('');
  expect(result.warning).toContain('不可用');
  expect(storage.encryptStringAsync).not.toHaveBeenCalled();
  expect(storage.decryptStringAsync).not.toHaveBeenCalled();
  expect(await readFile(join(directory, 'secret-key.bin'), 'utf8')).toBe('existing-cipher');
});

it('safeStorage 要求重新加密时保留同一主密钥并原子换封装', async () => {
  await writeFile(join(directory, 'secret-key.bin'), 'old-cipher');
  storage.decryptStringAsync.mockResolvedValueOnce({
    result: 'cd'.repeat(32),
    shouldReEncrypt: true,
  });
  expect(await loadSecretKey(directory, storage)).toEqual({ key: 'cd'.repeat(32) });
  expect(storage.encryptStringAsync).toHaveBeenCalledWith('cd'.repeat(32));
  expect(await readFile(join(directory, 'secret-key.bin'), 'utf8')).toBe('encrypted-master-key');
});

it('重加密失败不当作文件损坏，保留原文件供下次恢复', async () => {
  const file = join(directory, 'secret-key.bin');
  await writeFile(file, 'old-cipher');
  storage.decryptStringAsync.mockResolvedValueOnce({
    result: 'ab'.repeat(32),
    shouldReEncrypt: true,
  });
  storage.encryptStringAsync.mockRejectedValueOnce(new Error('加密暂时不可用'));
  await expect(loadSecretKey(directory, storage)).rejects.toThrow('加密暂时不可用');
  expect(await readFile(file, 'utf8')).toBe('old-cipher');
  expect(existsSync(`${file}.broken`)).toBe(false);
});

it('解密暂时不可用时保留原文件，不轮换主密钥', async () => {
  const file = join(directory, 'secret-key.bin');
  await writeFile(file, 'old-cipher');
  storage.decryptStringAsync.mockRejectedValueOnce(
    new Error('safeStorage.decryptStringAsync is temporarily unavailable. Please try again.'),
  );
  const result = await loadSecretKey(directory, storage);
  expect(result.key).toBe('');
  expect(result.warning).toContain('暂时不可用');
  expect(await readFile(file, 'utf8')).toBe('old-cipher');
  expect(existsSync(`${file}.broken`)).toBe(false);
  expect(storage.encryptStringAsync).not.toHaveBeenCalled();
});

it('读文件权限或类型错误不覆盖文件，替换失败清理临时文件', async () => {
  const file = join(directory, 'secret-key.bin');
  await mkdir(file);
  await expect(loadSecretKey(directory, storage)).rejects.toThrow();
  expect(existsSync(`${file}.broken`)).toBe(false);
  expect(storage.encryptStringAsync).not.toHaveBeenCalled();
  await rm(file, { recursive: true });
  storage.encryptStringAsync.mockImplementationOnce(async () => {
    await mkdir(file);
    return Buffer.from('encrypted');
  });
  await expect(loadSecretKey(directory, storage)).rejects.toThrow();
  expect(existsSync(file)).toBe(true);
  expect(existsSync(`${file}.tmp`)).toBe(false);
});
