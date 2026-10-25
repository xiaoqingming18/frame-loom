import type { ComponentType } from 'react';
import type {
  CanvasDocument,
  CanvasMediaData,
  CanvasRecord,
  CanvasView,
  MediaFile,
} from '@frame-loom/contracts';

/** 节点内生成需要的宿主能力；P5 由 desktop 用 engine client 实现。 */
export interface CanvasGenerationHost {
  /** 渲染节点内生成面板；返回 null 表示该节点暂不支持生成。 */
  Panel?: ComponentType<{
    nodeId: string;
    kind: 'image' | 'video';
    data: CanvasMediaData;
  }>;
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
