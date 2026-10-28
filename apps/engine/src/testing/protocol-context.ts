import { randomUUID } from 'node:crypto';
import {
  resolveEndpoints,
  resolvePromptReferences,
  SemanticRequest,
  type ProtocolDescriptor,
} from '@frame-loom/contracts';
import { applyExtras } from '../modules/generation/protocols/http.js';
import type { AdapterContext, HttpResult } from '../modules/generation/protocols/types.js';

export const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aV1cAAAAASUVORK5CYII=',
  'base64',
);
export const imageHash = 'a'.repeat(64);
export function protocolContext(
  descriptor: ProtocolDescriptor,
  kind: 'image' | 'video' | 'tts' = 'image',
): AdapterContext {
  const capability = structuredClone(descriptor.templates[kind]!);
  return {
    snapshot: {
      version: 1,
      protocolId: descriptor.id,
      protocolVersion: 'v1',
      modelId: randomUUID(),
      channelId: randomUUID(),
      upstreamModelId: 'arbitrary-model',
      kind,
      endpoints: resolveEndpoints(
        { baseUrl: 'http://127.0.0.1:12345/gateway/v1' },
        { upstreamModelId: 'arbitrary-model', endpointOverride: { confirmedHosts: [] } },
        descriptor,
      ).operations,
      capability,
      extras: [],
      fixedFields: [],
      transport: { image: descriptor.transports.image?.auto },
      concurrencyKey: 'test-channel',
      concurrency: 1,
      credentialFingerprint: 'test-fingerprint',
      configHash: 'test-hash',
      referenceUrls: {},
    },
    credentials: { apiKey: 'test-key', secretKey: '', headers: { 'x-private': 'test-header' } },
    signal: new AbortController().signal,
    fetchMedia: () => Promise.resolve({ bytes: png, mime: 'image/png' }),
    referenceUrl: (hash) => `http://127.0.0.1:12345/media/${hash}`,
    resolvePrompt: (prompt, inputs) =>
      resolvePromptReferences(
        prompt,
        inputs.map((input) => ({ id: input.sha256, kind: input.kind })),
        capability.kind === 'video' ? capability.promptRef.syntax : 'ordinal',
        1,
      ).prompt,
    applyExtras,
    diagnose: () => {},
  };
}
export function semanticRequest(
  ctx: AdapterContext,
  input: Partial<SemanticRequest> = {},
): SemanticRequest {
  return SemanticRequest.parse({
    modelId: ctx.snapshot.modelId,
    prompt: '测试',
    inputs: [],
    ...input,
  });
}
export function httpResult(body: unknown): HttpResult {
  return {
    status: 200,
    headers: new Headers(),
    bytes: new TextEncoder().encode(JSON.stringify(body)),
  };
}
