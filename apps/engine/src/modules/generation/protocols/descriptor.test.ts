import { expect, it } from 'vitest';
import { protocolContext, semanticRequest } from '../../../testing/protocol-context.js';
import { ProtocolRegistry } from './registry.js';

it.each(
  [...new ProtocolRegistry().adapters.values()].flatMap((adapter) =>
    adapter.descriptor.kinds.filter((kind) => kind !== 'chat').map((kind) => ({ adapter, kind })),
  ),
)('$adapter.descriptor.id $kind 的写入顶层字段全部受保护', async ({ adapter, kind }) => {
  const ctx = protocolContext(adapter.descriptor, kind);
  const req = semanticRequest(ctx, {
    ...(kind === 'video' ? { mode: 't2v' } : {}),
    ...(kind === 'tts' ? { params: { voice: 'test-voice' } } : {}),
  });
  const call = await adapter.buildSubmit(ctx, req, ctx.snapshot.capability);
  const keys =
    call.body instanceof FormData
      ? [...call.body.keys()]
      : Object.keys(JSON.parse(call.body as string) as object);
  for (const key of keys) expect(adapter.descriptor.reservedFields, key).toContain(key);
});
