import { isAbsolute } from 'node:path';
import { z } from 'zod';

const origin = z.string().refine((value) => {
  try {
    const url = new URL(value);
    return (
      ['http:', 'https:', 'app:'].includes(url.protocol) &&
      url.hostname !== '' &&
      url.username === '' &&
      url.password === '' &&
      value === `${url.protocol}//${url.host}`
    );
  } catch {
    return false;
  }
}, '允许源必须是完整的 http(s)://<主机[:端口]> 或 app://<主机>，不能包含路径');

const environment = z.object({
  FRAME_LOOM_TOKEN: z
    .string({ error: '必须提供令牌' })
    .regex(/^[0-9a-fA-F]{64}$/, '令牌必须是 64 位十六进制字符串')
    .length(64, '令牌必须是 64 位十六进制字符串'),
  FRAME_LOOM_DATA_DIR: z
    .string({ error: '必须提供数据目录' })
    .refine(isAbsolute, '数据目录必须是绝对路径'),
  FRAME_LOOM_ALLOWED_ORIGINS: z
    .string()
    .default('[]')
    .transform((value, ctx) => {
      try {
        return JSON.parse(value) as unknown;
      } catch {
        ctx.addIssue({ code: 'custom', message: '允许源必须是 JSON 字符串数组' });
        return z.NEVER;
      }
    })
    .pipe(z.array(origin, { error: '允许源必须是 JSON 字符串数组' })),
});

export class EngineConfig {
  constructor(
    readonly token: string,
    readonly dataDir: string,
    readonly allowedOrigins: string[],
  ) {}
}

export function loadConfig(env: NodeJS.ProcessEnv): EngineConfig {
  const result = environment.safeParse(env);
  if (!result.success) {
    throw new Error(
      `engine 配置无效：${result.error.issues
        .map((issue) => `${issue.path.join('.')}：${issue.message}`)
        .join('；')}`,
    );
  }
  return new EngineConfig(
    result.data.FRAME_LOOM_TOKEN,
    result.data.FRAME_LOOM_DATA_DIR,
    result.data.FRAME_LOOM_ALLOWED_ORIGINS,
  );
}
