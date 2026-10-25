import { useMemo } from 'react';
import { MediaFile } from '@frame-loom/contracts';
import { CanvasEditor, type CanvasHost } from '@frame-loom/canvas';
import type { EngineClient } from '@/lib/engine-client';

/** 画布测试页：用 engine client 实现画布宿主接口，供人工验收。 */
export function CanvasLab({ engineClient }: { engineClient: EngineClient }) {
  const host = useMemo<CanvasHost>(
    () => ({
      media: {
        upload: (file, signal) =>
          engineClient.request('/media', MediaFile, {
            method: 'POST',
            body: file,
            signal,
            timeoutMs: 120_000,
          }),
        url: (sha256) => `frame-media://${sha256}`,
      },
    }),
    [engineClient],
  );
  return (
    <section aria-label="画布测试" className="size-full">
      <CanvasEditor host={host} />
    </section>
  );
}
