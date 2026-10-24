import { ConsoleLogger } from '@nestjs/common';

export class EngineLogger extends ConsoleLogger {
  constructor(private readonly token: string) {
    super('Engine', {
      logLevels: ['error', 'warn', 'log'],
      colors: false,
      redact: ['token', 'authorization'],
    });
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
    const withoutToken = this.token ? message.replaceAll(this.token, '[REDACTED]') : message;
    return withoutToken
      .replace(/\bAuthorization\s*[:=]\s*[^\r\n]+/gi, 'Authorization: [REDACTED]')
      .replace(/\bBearer\s+[^\s"']+/gi, 'Bearer [REDACTED]');
  }
}
