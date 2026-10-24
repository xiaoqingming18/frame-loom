import type { PipeTransform } from '@nestjs/common';
import { z } from 'zod';

export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: z.ZodType<T>) {}

  transform(value: unknown): T {
    return this.schema.parse(value, { error: z.locales.zhCN().localeError });
  }
}
