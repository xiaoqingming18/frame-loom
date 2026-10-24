import { Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { EngineConfig } from '../config/config.js';
import { DomainError } from '../http/domain-error.js';
import { EngineLogger } from '../logging/engine-logger.js';

@Injectable()
export class SecretCipher {
  constructor(
    private readonly config: EngineConfig,
    private readonly logger: EngineLogger,
  ) {}

  encrypt(value: string, table: string, rowId: string): Buffer {
    this.logger.registerSecret(value);
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key(), iv);
    cipher.setAAD(Buffer.from(JSON.stringify([table, rowId])));
    const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
  }

  decrypt(value: Buffer, table: string, rowId: string): string {
    const key = this.key();
    try {
      if (value.length < 28) throw new Error('密文长度无效');
      const cipher = createDecipheriv('aes-256-gcm', key, value.subarray(0, 12));
      cipher.setAuthTag(value.subarray(12, 28));
      cipher.setAAD(Buffer.from(JSON.stringify([table, rowId])));
      const plaintext = Buffer.concat([cipher.update(value.subarray(28)), cipher.final()]).toString(
        'utf8',
      );
      this.logger.registerSecret(plaintext);
      return plaintext;
    } catch {
      throw new DomainError('SECRET_DECRYPTION_FAILED', 422, '密钥无法解密，请重新填写');
    }
  }

  private key(): Buffer {
    if (!this.config.secretKey) {
      throw new DomainError(
        'SECRET_KEY_UNAVAILABLE',
        503,
        '系统安全存储不可用，无法保存或读取密钥',
      );
    }
    return Buffer.from(this.config.secretKey, 'hex');
  }
}
