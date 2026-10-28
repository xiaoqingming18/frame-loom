import type { CanvasDocument, CanvasEdge, CanvasNode } from '@frame-loom/contracts';
import { GenerationJob, getProtocol, type Capability } from '@frame-loom/contracts';
import type { CanvasGenerationModel } from './host';
import { emptyMedia } from './nodes/media';

export const sha = (char: string) => char.repeat(64);

export function generationModelFixture(
  protocolId = 'openai-images',
  capability?: Capability,
): CanvasGenerationModel {
  const protocol = structuredClone(getProtocol(protocolId)!);
  const cap =
    capability ??
    structuredClone(
      protocol.templates.image ?? protocol.templates.video ?? protocol.templates.tts!,
    );
  return {
    id: '22222222-2222-4222-8222-222222222222',
    label: '图片模型',
    kind: cap.kind as 'image' | 'video' | 'tts',
    capability: cap,
    protocol,
    transport: { image: 'inline', video: 'url', audio: 'url' },
    extras: [],
  };
}

export function generationJob(overrides: Partial<GenerationJob> = {}): GenerationJob {
  const modelId = '22222222-2222-4222-8222-222222222222';
  const date = '2026-10-25T00:00:00.000Z';
  return GenerationJob.parse({
    id: '11111111-1111-4111-8111-111111111111',
    kind: 'image',
    modelId,
    configHash: 'test',
    status: 'succeeded',
    request: {
      modelId,
      prompt: '生成画面',
      params: {},
      inputs: [],
      source: 'canvas',
    },
    remoteTaskId: null,
    remoteStatus: null,
    attempts: 0,
    nextPollAt: null,
    errorCategory: null,
    errorCode: null,
    errorMessage: null,
    outputs: [
      {
        sha256: sha('a'),
        mime: 'image/png',
        bytes: 12,
        width: 256,
        height: 256,
        durationMs: null,
        createdAt: date,
      },
    ],
    createdAt: date,
    updatedAt: date,
    finishedAt: date,
    ...overrides,
  });
}

export function media(
  id: string,
  type: 'image' | 'video' = 'image',
  extra: Partial<CanvasNode> = {},
): CanvasNode {
  return {
    id,
    type,
    typeVersion: 3,
    position: { x: 0, y: 0 },
    size: { width: 100, height: 100 },
    title: id,
    data: emptyMedia(type === 'video' ? 't2v' : undefined),
    ...extra,
  };
}

export function group(id: string, extra: Partial<CanvasNode> = {}): CanvasNode {
  return {
    id,
    type: 'group',
    typeVersion: 1,
    position: { x: 0, y: 0 },
    size: { width: 400, height: 300 },
    data: { color: 'gray' },
    ...extra,
  };
}

export function edge(
  id: string,
  source: string,
  target: string,
  targetHandle = 'reference',
): CanvasEdge {
  return { id, source, target, sourceHandle: 'out', targetHandle };
}

export function doc(nodes: CanvasNode[], edges: CanvasEdge[] = []): CanvasDocument {
  return { schemaVersion: 1, nodes, edges };
}
