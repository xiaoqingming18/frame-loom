import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SafeStorage } from 'electron';

export async function loadSecretKey(
  userData: string,
  storage: Pick<
    SafeStorage,
    'isAsyncEncryptionAvailable' | 'encryptStringAsync' | 'decryptStringAsync'
  >,
): Promise<{ key: string; warning?: string }> {
  if (!(await storage.isAsyncEncryptionAvailable())) {
    return { key: '', warning: '系统安全存储不可用，当前无法保存或读取模型及对象存储密钥。' };
  }
  const file = join(userData, 'secret-key.bin');
  let encrypted: Buffer | undefined;
  try {
    encrypted = await readFile(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  let warning: string | undefined;
  if (encrypted) {
    let decrypted: Awaited<ReturnType<SafeStorage['decryptStringAsync']>> | undefined;
    try {
      decrypted = await storage.decryptStringAsync(encrypted);
      if (!/^[0-9a-fA-F]{64}$/.test(decrypted.result) || decrypted.result.length !== 64) {
        throw new Error('主密钥格式无效');
      }
    } catch (error) {
      // shortcut: Electron 45 仅用错误消息区分暂时不可用，升级 Electron 时复核，避免误轮换主密钥。
      if (error instanceof Error && error.message.includes('temporarily unavailable')) {
        return { key: '', warning: '系统安全存储暂时不可用，主密钥已保留，请稍后重启应用。' };
      }
      await rename(file, `${file}.broken`);
      warning = '原主密钥无法解密，已备份并生成新密钥。已保存的模型及对象存储密钥需要重新填写。';
    }
    if (decrypted && !warning) {
      if (decrypted.shouldReEncrypt) await persist(decrypted.result);
      return { key: decrypted.result };
    }
  }
  const key = randomBytes(32).toString('hex');
  await persist(key);
  return { key, ...(warning ? { warning } : {}) };

  async function persist(key: string): Promise<void> {
    const cipher = await storage.encryptStringAsync(key);
    await mkdir(userData, { recursive: true });
    const temporary = `${file}.tmp`;
    try {
      await writeFile(temporary, cipher, { mode: 0o600 });
      await rename(temporary, file);
    } finally {
      await rm(temporary, { force: true });
    }
  }
}
