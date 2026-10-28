import type {
  Capability,
  GenerationErrorCategory,
  GenerationJob,
  MediaKind,
  Operation,
  ProtocolDescriptor,
  SemanticRequest,
} from '@frame-loom/contracts';
import type { ExtraParam, FixedField, ModelKind } from '@frame-loom/contracts/model-service';

export type JobSnapshot = {
  version: 1;
  protocolId: string;
  protocolVersion: 'v1';
  modelId: string;
  channelId: string;
  upstreamModelId: string;
  kind: ModelKind;
  endpoints: Partial<Record<Operation, { method: 'GET' | 'POST'; url: string }>>;
  capability: Capability;
  extras: ExtraParam[];
  fixedFields: FixedField[];
  transport: Partial<Record<MediaKind, 'inline' | 'url'>>;
  concurrencyKey: string;
  concurrency: number;
  credentialFingerprint: string;
  configHash: string;
  preparedBody?: unknown;
  referenceUrls: Record<string, string>;
  completedDownloads?: number[];
  imageEditPostProcess?: { intermediateSha256?: string; finalSha256?: string };
  cancellation?: 'requested' | 'confirmed' | 'unknown';
};
export type Credentials = { apiKey: string; secretKey: string; headers: Record<string, string> };
export type HttpCall = {
  operation: Operation | 'cancel';
  url: string;
  method: 'GET' | 'POST';
  headers: Record<string, string>;
  body?: string | FormData | Uint8Array;
};
export type HttpResult = { status: number; headers: Headers; bytes: Uint8Array };
export type OutputRef =
  | { kind: 'url'; url: string; mime?: string }
  | { kind: 'data'; base64: string; mime: string }
  | { kind: 'content'; ref: string; mime?: string };
export type AdapterResult =
  | { status: 'running'; remoteTaskId: string; remoteStatus: string }
  | { status: 'succeeded'; outputs: OutputRef[]; usage?: unknown }
  | { status: 'failed'; category: GenerationErrorCategory; code: string; message: string };
export type AdapterContext = {
  snapshot: JobSnapshot;
  credentials: Credentials;
  signal: AbortSignal;
  fetchMedia(sha256: string): Promise<{ bytes: Uint8Array; mime: string }>;
  referenceUrl(sha256: string): string;
  resolvePrompt(prompt: string, inputs: SemanticRequest['inputs']): string;
  applyExtras(
    body: Record<string, unknown>,
    extras: ExtraParam[],
    fixedFields: FixedField[],
    values: SemanticRequest['extras'],
  ): void;
  diagnose(diagnostic: NonNullable<GenerationJob['diagnostic']>): void;
};
export interface ProtocolAdapter {
  descriptor: ProtocolDescriptor;
  buildSubmit(ctx: AdapterContext, request: SemanticRequest, cap: Capability): Promise<HttpCall>;
  parseSubmit(ctx: AdapterContext, result: HttpResult): Promise<AdapterResult>;
  buildQuery?(ctx: AdapterContext, remoteTaskId: string): HttpCall;
  parseQuery?(ctx: AdapterContext, result: HttpResult): Promise<AdapterResult>;
  buildCancel?(ctx: AdapterContext, remoteTaskId: string): HttpCall;
  buildContent?(ctx: AdapterContext, ref: string): HttpCall;
  listVoices?(ctx: AdapterContext): Promise<{ id: string; name: string }[]>;
}
