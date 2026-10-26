import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { type CanvasMediaVersion } from '@frame-loom/contracts';
import type { CanvasHost } from '@frame-loom/canvas';
import type { EngineClient } from '@/lib/engine-client';
import { CanvasAssetDialog } from './canvas-asset-dialog';

export type CanvasAssetRequest =
  | {
      kind: 'pick';
      mediaKind?: 'image' | 'video';
      resolve: (value: Awaited<ReturnType<NonNullable<CanvasHost['assets']>['pick']>>) => void;
    }
  | { kind: 'save'; version: CanvasMediaVersion; name?: string; resolve: () => void };
export function useCanvasAssets(client: EngineClient, projectId: string) {
  const [request, setRequest] = useState<CanvasAssetRequest | null>(null);
  const pending = useRef<CanvasAssetRequest | null>(null);
  const host = useMemo(
    (): NonNullable<CanvasHost['assets']> => ({
      pick: (mediaKind) =>
        new Promise((resolve) => {
          if (pending.current) {
            resolve(null);
            return;
          }
          const next: CanvasAssetRequest = { kind: 'pick', mediaKind, resolve };
          pending.current = next;
          setRequest(next);
        }),
      save: (version, name) =>
        new Promise((resolve) => {
          if (pending.current) {
            resolve();
            return;
          }
          const next: CanvasAssetRequest = { kind: 'save', version, name, resolve };
          pending.current = next;
          setRequest(next);
        }),
    }),
    [],
  );
  useEffect(
    () => () => {
      const current = pending.current;
      if (current?.kind === 'pick') current.resolve(null);
      else current?.resolve();
      pending.current = null;
    },
    [],
  );
  const close = useCallback(() => {
    const current = pending.current;
    if (current?.kind === 'pick') current.resolve(null);
    else current?.resolve();
    pending.current = null;
    setRequest(null);
  }, []);
  return {
    host,
    dialog: request && (
      <CanvasAssetDialog client={client} projectId={projectId} request={request} onClose={close} />
    ),
  };
}
