import { z } from 'zod';
import { GenerationFailure } from './types.js';

export const ImageData = z.object({
  data: z
    .array(z.object({ url: z.url().optional(), b64_json: z.string().min(1).optional() }))
    .min(1)
    .max(16),
  usage: z.unknown().optional(),
});

export async function imageResponse(response: Response): Promise<unknown> {
  if (!response.ok) {
    // 只保留安全错误码，避免上游消息回显密钥、提示词或签名链接。
    let code = `HTTP_${response.status}`;
    try {
      const body = z
        .object({
          error: z
            .object({
              code: z.union([z.string(), z.number()]).optional(),
              type: z.string().optional(),
            })
            .optional(),
        })
        .parse(await response.json());
      const raw = String(body.error?.code ?? body.error?.type ?? code);
      if (/^[\w.-]{1,100}$/.test(raw)) code = raw;
    } catch {
      /* 非 JSON 错误仍按 HTTP 状态分类。 */
    }
    const moderation =
      /1026|unprocessable_entity_error|moderation|safety|content_policy|blocked|sensitive|risk/i.test(
        code,
      );
    const category = moderation
      ? 'moderation'
      : response.status === 401 || response.status === 403
        ? 'auth'
        : response.status === 429
          ? 'rate_limit'
          : response.status === 402
            ? 'quota'
            : response.status === 400 || response.status === 422
              ? 'invalid_params'
              : 'upstream';
    throw new GenerationFailure(
      category,
      code,
      {
        moderation: '内容未通过审核',
        auth: '鉴权失败，请检查渠道密钥',
        rate_limit: '上游限流，正在退避',
        quota: '上游额度不足',
        invalid_params: '上游拒绝了生成参数',
        upstream: '上游响应失败',
      }[category],
      response.status === 429,
      response.status >= 500,
    );
  }
  try {
    return await response.json();
  } catch {
    throw new GenerationFailure(
      'upstream',
      'INVALID_RESPONSE',
      '上游响应不完整，无法确认提交结果',
      false,
      true,
    );
  }
}

export function imageOutputs(json: unknown) {
  const parsed = ImageData.safeParse(json);
  if (!parsed.success || parsed.data.data.some((item) => !item.url && !item.b64_json))
    throw new GenerationFailure('upstream', 'INVALID_RESPONSE', '未收到有效图片产物', false, true);
  return {
    status: 'succeeded' as const,
    outputs: parsed.data.data.map((item) => ({
      ...(item.b64_json ? { data: item.b64_json } : { url: item.url }),
      mime: 'image/png',
    })),
    usage: parsed.data.usage,
  };
}
