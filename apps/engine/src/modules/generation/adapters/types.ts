import type {
  GenerationErrorCategory,
  GenerationRequest,
  MediaProtocol,
  ModelProfile,
} from '@frame-loom/contracts';

export type AdapterContext = {
  baseUrl: string;
  apiKey: string;
  headers: Record<string, string>;
  model: string;
  signal: AbortSignal;
  profile?: ModelProfile;
  connection?: import('@frame-loom/contracts').ModelConnection;
  referenceUrls?: Record<string, string>;
  idempotencyKey?: string;
  stage?: 'submit' | 'query';
  diagnose?: (
    value: NonNullable<import('@frame-loom/contracts').GenerationJob['diagnostic']>,
  ) => void;
};
export type AdapterOutput = { url?: string; data?: string; mime: string; providerContent?: string };
export type AdapterResult =
  | { status: 'running'; remoteTaskId: string; remoteStatus: string }
  | { status: 'succeeded'; outputs: AdapterOutput[]; usage?: unknown }
  | { status: 'failed'; category: GenerationErrorCategory; code: string; message: string };
export interface GenerationAdapter {
  protocol: MediaProtocol;
  submit(ctx: AdapterContext, request: GenerationRequest): Promise<AdapterResult>;
  query?(ctx: AdapterContext, remoteTaskId: string): Promise<AdapterResult>;
  cancel?(ctx: AdapterContext, remoteTaskId: string): Promise<void>;
  contentUrl?(ctx: AdapterContext, remoteTaskId: string): string;
}
export class GenerationFailure extends Error {
  constructor(
    readonly category: GenerationErrorCategory,
    readonly code: string,
    message: string,
    readonly safeRetry = false,
    readonly uncertain = false,
  ) {
    super(message);
  }
}

export async function adapterFetch(
  ctx: AdapterContext,
  url: string,
  init: RequestInit,
  stage: 'upload' | 'submit' | 'query' = ctx.stage ?? 'submit',
) {
  const parsed = new URL(url);
  const diagnostic = {
    stage,
    method: init.method ?? 'GET',
    route: parsed.origin + parsed.pathname,
  };
  ctx.diagnose?.(diagnostic);
  const response = await fetch(url, init);
  const candidate =
    response.headers.get('x-request-id') ?? response.headers.get('request-id') ?? '';
  const requestId = [ctx.apiKey, ...Object.values(ctx.headers)].some(
    (secret) => secret && candidate.includes(secret),
  )
    ? ''
    : candidate;
  ctx.diagnose?.({
    ...diagnostic,
    httpStatus: response.status,
    ...(/^[\w.-]{1,100}$/.test(requestId) ? { requestId } : {}),
  });
  return response;
}
