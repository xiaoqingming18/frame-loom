import type {
  GenerationErrorCategory,
  GenerationRequest,
  MediaProtocol,
} from '@frame-loom/contracts';

export type AdapterContext = {
  baseUrl: string;
  apiKey: string;
  headers: Record<string, string>;
  model: string;
  signal: AbortSignal;
  referenceUrls?: Record<string, string>;
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
