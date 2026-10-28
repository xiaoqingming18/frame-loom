import { getProtocol, fillEndpoint, type SemanticRequest } from '@frame-loom/contracts';
import type { ProtocolAdapter, AdapterResult } from '../modules/generation/protocols/types.js';
import { authHeaders } from '../modules/generation/protocols/http.js';

// 仅在测试显式注册，不加入产品协议列表。
export function fakeProtocol(): ProtocolAdapter {
  const descriptor = structuredClone(getProtocol('openai-images')!);
  descriptor.id = 'test-image';
  descriptor.transports.image = { allowed: ['inline', 'url'], auto: 'inline' };
  descriptor.templates.image!.references = { formats: ['image/png'] };
  descriptor.ceiling.image!.edit = true;
  descriptor.ceiling.image!.mask = ['alpha'];
  descriptor.operations = {
    submit: { method: 'POST', path: '/fake/submit', encoding: 'json' },
    query: { method: 'GET', path: '/fake/tasks/{id}' },
    content: { method: 'GET', path: '/fake/content/{id}', auth: true },
  };
  descriptor.poll = { initialMs: 10, maxMs: 20, timeoutMs: 2000 };
  const build = (
    ctx: Parameters<ProtocolAdapter['buildSubmit']>[0],
    operation: 'submit' | 'query' | 'content',
    id?: string,
  ) => {
    const endpoint = ctx.snapshot.endpoints[operation]!;
    return {
      operation,
      method: endpoint.method,
      url: fillEndpoint(endpoint.url, id ? { id } : {}),
      headers: {
        ...authHeaders(descriptor.auth, ctx.credentials),
        'Content-Type': 'application/json',
      },
    };
  };
  const parse = (_ctx: unknown, result: { bytes: Uint8Array }) =>
    Promise.resolve(JSON.parse(new TextDecoder().decode(result.bytes)) as AdapterResult);
  return {
    descriptor,
    buildSubmit: async (ctx, req: SemanticRequest) => {
      const inputs = await Promise.all(
        req.inputs.map(async (input) => ({
          sha256: input.sha256,
          ...(ctx.snapshot.transport[input.kind] === 'url'
            ? { url: ctx.referenceUrl(input.sha256) }
            : { data: Buffer.from((await ctx.fetchMedia(input.sha256)).bytes).toString('base64') }),
        })),
      );
      return {
        ...build(ctx, 'submit'),
        body: JSON.stringify({ model: ctx.snapshot.upstreamModelId, prompt: req.prompt, inputs }),
      };
    },
    parseSubmit: parse,
    buildQuery: (ctx, id) => build(ctx, 'query', id),
    parseQuery: parse,
    buildContent: (ctx, id) => build(ctx, 'content', id),
  };
}
