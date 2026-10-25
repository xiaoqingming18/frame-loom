import { z } from 'zod';

export const ObjectStorageWrite = z.strictObject({
  endpoint: z.url().refine((value) => {
    const url = new URL(value);
    return (
      ['http:', 'https:'].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      url.pathname === '/'
    );
  }, '端点必须为不含路径、凭据和查询参数的 HTTP(S) 地址'),
  region: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .regex(/^[\w-]+$/),
  bucket: z
    .string()
    .trim()
    .min(1)
    .max(255)
    .regex(/^[a-zA-Z0-9._-]+$/),
  accessKeyId: z.string().trim().min(1).max(300),
  secretAccessKey: z.string().max(2000).optional(),
  forcePathStyle: z.boolean().default(true),
  keyPrefix: z
    .string()
    .trim()
    .max(200)
    .regex(/^[a-zA-Z0-9/_-]*$/)
    .default('frame-loom'),
  presignTtlSeconds: z.number().int().min(3600).max(604800).default(86400),
});
export type ObjectStorageWrite = z.infer<typeof ObjectStorageWrite>;
export const ObjectStorageConfig = ObjectStorageWrite.omit({ secretAccessKey: true }).extend({
  hasSecret: z.boolean(),
  secretNeedsUpdate: z.boolean(),
});
export type ObjectStorageConfig = z.infer<typeof ObjectStorageConfig>;
export const ObjectStorageState = ObjectStorageConfig.nullable();
export const ObjectStorageCheck = z.object({
  ok: z.boolean(),
  steps: z.object({
    upload: z.boolean(),
    sign: z.boolean(),
    download: z.boolean(),
    delete: z.boolean(),
  }),
  message: z.string(),
});
export type ObjectStorageCheck = z.infer<typeof ObjectStorageCheck>;
