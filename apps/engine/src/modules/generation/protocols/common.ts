import { z } from 'zod';
import {
  fillEndpoint,
  type Operation,
  type ProtocolDescriptor,
  type SemanticRequest,
} from '@frame-loom/contracts';
import { authHeaders, GenerationFailure } from './http.js';
import type { AdapterContext, AdapterResult, HttpCall, HttpResult, OutputRef } from './types.js';

export function invalidResponse(): never {
  throw new GenerationFailure(
    'upstream',
    'INVALID_RESPONSE',
    '上游返回无法识别，提交结果可能不确定',
  );
}
export function jsonResult<T>(result: HttpResult, schema: z.ZodType<T>): T {
  try {
    return schema.parse(JSON.parse(new TextDecoder().decode(result.bytes)));
  } catch {
    return invalidResponse();
  }
}
export function endpointCall(
  ctx: AdapterContext,
  descriptor: ProtocolDescriptor,
  operation: Operation,
  values: Record<string, string> = {},
): HttpCall {
  const endpoint = ctx.snapshot.endpoints[operation];
  if (!endpoint)
    throw new GenerationFailure('invalid_params', 'MISSING_ENDPOINT', '协议操作地址缺失');
  return {
    operation,
    method: endpoint.method,
    url: fillEndpoint(endpoint.url, values),
    headers: authHeaders(descriptor.auth, ctx.credentials, descriptor.fixedHeaders),
  };
}
export function jsonCall(
  ctx: AdapterContext,
  descriptor: ProtocolDescriptor,
  request: SemanticRequest,
  body: Record<string, unknown>,
  operation: Operation = 'submit',
  values?: Record<string, string>,
): HttpCall {
  ctx.applyExtras(body, ctx.snapshot.extras, ctx.snapshot.fixedFields, request.extras);
  const call = endpointCall(ctx, descriptor, operation, values);
  return {
    ...call,
    headers: { ...call.headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}
export async function dataUrl(ctx: AdapterContext, hash: string): Promise<string> {
  if (ctx.snapshot.transport.image === 'url') return ctx.referenceUrl(hash);
  const media = await ctx.fetchMedia(hash);
  return `data:${media.mime};base64,${Buffer.from(media.bytes).toString('base64')}`;
}
export async function appendMedia(form: FormData, key: string, ctx: AdapterContext, hash: string) {
  const media = await ctx.fetchMedia(hash);
  const extension = media.mime.split('/')[1]?.replace(/[^a-z0-9]/gi, '') || 'bin';
  form.append(
    key,
    new Blob([Uint8Array.from(media.bytes)], { type: media.mime }),
    `${hash}.${extension}`,
  );
}
export function appendFields(form: FormData, fields: Record<string, unknown>) {
  for (const [key, value] of Object.entries(fields))
    if (value !== undefined)
      form.append(key, typeof value === 'string' ? value : JSON.stringify(value));
}
const imageResponse = z.object({
  data: z
    .array(z.object({ b64_json: z.string().optional(), url: z.string().optional() }))
    .optional(),
  error: z.unknown().optional(),
  usage: z.unknown().optional(),
});
export function imageResult(result: HttpResult, mime: string): AdapterResult {
  const body = jsonResult(result, imageResponse);
  if (body.error) {
    const error = z.object({ code: z.string().optional() }).safeParse(body.error);
    const code = error.success ? (error.data.code ?? '').toLowerCase() : '';
    return {
      status: 'failed',
      category: /content_policy|contentfilter|moderation|sensitive/.test(code)
        ? 'moderation'
        : /invalid_api_key|authentication/.test(code)
          ? 'auth'
          : /insufficient_quota/.test(code)
            ? 'quota'
            : /rate_limit/.test(code)
              ? 'rate_limit'
              : /invalid_parameter|invalid_request/.test(code)
                ? 'invalid_params'
                : 'upstream',
      code: 'IMAGE_FAILED',
      message: '上游图像生成失败',
    };
  }
  const outputs: OutputRef[] = (body.data ?? []).map((item) => {
    if (item.b64_json && /^[A-Za-z0-9+/]+={0,2}$/.test(item.b64_json)) {
      const bytes = Buffer.from(item.b64_json, 'base64');
      const detected = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        ? 'image/png'
        : bytes[0] === 255 && bytes[1] === 216
          ? 'image/jpeg'
          : bytes.subarray(8, 12).toString() === 'WEBP'
            ? 'image/webp'
            : mime;
      return { kind: 'data', base64: item.b64_json, mime: detected };
    }
    if (item.url) return { kind: 'url', url: item.url, mime };
    return invalidResponse();
  });
  if (!outputs.length) return invalidResponse();
  return { status: 'succeeded', outputs, usage: body.usage };
}
