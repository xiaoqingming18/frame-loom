import { z } from 'zod';

export const EngineConnection = z.object({
  baseUrl: z.string().refine((value) => {
    const match = /^http:\/\/127\.0\.0\.1:([1-9]\d{0,4})$/.exec(value);
    // $ 可匹配末尾换行之前的位置，还需确认匹配覆盖整个地址。
    return match !== null && match[0] === value && Number(match[1]) <= 65535;
  }, '连接地址必须是 http://127.0.0.1:<端口>，端口范围为 1–65535'),
  token: z.string().min(1),
});

export type EngineConnection = z.infer<typeof EngineConnection>;
