import { ConsoleLogger } from '@nestjs/common';

export class EngineLogger extends ConsoleLogger {
  private readonly secrets = new Set<string>();

  constructor(token: string, secretKey = '') {
    super('Engine', {
      logLevels: ['error', 'warn', 'log'],
      colors: false,
      redact: ['token', 'authorization', 'x-api-key', 'api-key', 'x-goog-api-key'],
    });
    this.registerSecret(token);
    this.registerSecret(secretKey);
  }

  registerSecret(secret: string): void {
    if (secret) this.secrets.add(secret);
  }

  protected override printMessages(...args: Parameters<ConsoleLogger['printMessages']>): void {
    args[3] = 'stderr';
    super.printMessages(...args);
  }

  protected override formatMessage(...args: Parameters<ConsoleLogger['formatMessage']>): string {
    return this.sanitize(super.formatMessage(...args));
  }

  protected override printStackTrace(stack?: string): void {
    if (stack) super.printStackTrace(this.sanitize(stack));
  }

  private sanitize(message: string): string {
    for (const secret of this.secrets) message = message.replaceAll(secret, '[REDACTED]');
    return message
      .replace(
        /(["']?\b(?:authorization|x-api-key|api-key|x-goog-api-key)["']?\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\r\n,}]+)/gi,
        '$1[REDACTED]',
      )
      .replace(
        /([?&](?:key|x-amz-[\w-]+|x-oss-[\w-]+|ossaccesskeyid|signature|security-token|q-[\w-]+)=)[^&#\s"'<>]*/gi,
        '$1[REDACTED]',
      )
      .replace(/\bBearer\s+[^\s"']+/gi, 'Bearer [REDACTED]');
  }
}
