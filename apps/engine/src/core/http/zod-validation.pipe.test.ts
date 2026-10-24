import { expect, it } from 'vitest';
import { z } from 'zod';
import { ZodValidationPipe } from './zod-validation.pipe.js';

it('返回 schema 解析后的值，包括类型转换', () => {
  const pipe = new ZodValidationPipe(z.object({ count: z.coerce.number().int().positive() }));
  expect(pipe.transform({ count: '2' })).toEqual({ count: 2 });
});

it('无效参数抛出保留路径和中文消息的 ZodError', () => {
  const pipe = new ZodValidationPipe(z.object({ name: z.string() }));
  expect(() => pipe.transform({ name: 1 })).toThrow(z.ZodError);
  try {
    pipe.transform({ name: 1 });
  } catch (error) {
    expect((error as z.ZodError).issues[0]).toMatchObject({ path: ['name'] });
    expect((error as z.ZodError).issues[0]?.message).toMatch(/[\u4e00-\u9fff]/);
  }
});
