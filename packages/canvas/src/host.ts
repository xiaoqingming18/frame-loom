import type { ComponentType } from 'react';
import type {
  CanvasDocument,
  CanvasMediaData,
  CanvasRecord,
  CanvasView,
  GenerationJob,
  GenerationRequest,
  MediaFile,
  ModelProfile,
} from '@frame-loom/contracts';

export interface CanvasGenerationModel {
  id: string;
  label: string;
  kind: 'image' | 'video';
  profile: ModelProfile | null;
}

export interface CanvasGenerationConfig {
  models: CanvasGenerationModel[];
  storageReady: boolean;
}

/** 宿主负责模型配置与任务通信，画布负责输入映射、编辑与结果写回。 */
export interface CanvasGenerationHost {
  Panel?: ComponentType<{ nodeId: string; kind: 'image' | 'video'; data: CanvasMediaData }>;
  load(signal: AbortSignal): Promise<CanvasGenerationConfig>;
  create(request: GenerationRequest): Promise<GenerationJob>;
  get(id: string, signal: AbortSignal): Promise<GenerationJob>;
  cancel(id: string): Promise<GenerationJob>;
  subscribe(changed: (jobId: string) => void, signal: AbortSignal): void;
}

/** 画布包对外部世界的全部依赖，由宿主注入；画布包不直接访问 engine 或路由。 */
export interface CanvasHost {
  media: {
    upload(file: Blob, signal?: AbortSignal): Promise<MediaFile>;
    url(sha256: string): string;
  };
  documents?: {
    load(id: string): Promise<CanvasRecord | null>;
    save(id: string, revision: number, document: CanvasDocument): Promise<{ revision: number }>;
    saveView(id: string, view: CanvasView): Promise<void>;
  };
  generation?: CanvasGenerationHost;
}
