import { useEffect, useRef, useState } from 'react';
import type * as Three from 'three';
import type { CanvasMediaVersion } from '@frame-loom/contracts';
import { Button } from '@frame-loom/ui/components/button';
import { Dialog, DialogContent, DialogTitle } from '@frame-loom/ui/components/dialog';
import { useCanvas } from '../context';
import { createPanoramaCaptures } from '../commands/commands';
import {
  panoramaCaptureSize,
  panoramaDirection,
  panoramaRatios,
  panoramaResolutionHint,
} from './panorama';

type View = { yaw: number; pitch: number; fov: number };
const initialView: View = { yaw: 0, pitch: 0, fov: 75 };

export function PanoramaViewer({
  nodeId,
  hash,
  width,
  onClose,
}: {
  nodeId: string;
  hash: string;
  width: number;
  onClose: () => void;
}) {
  const { host, store, registry } = useCanvas();
  const container = useRef<HTMLDivElement>(null);
  const runtime = useRef<{
    three: typeof Three;
    renderer: Three.WebGLRenderer;
    camera: Three.PerspectiveCamera;
    render: (view: View) => void;
  } | null>(null);
  const view = useRef<View>({ ...initialView });
  const [status, setStatus] = useState('正在加载全景…');
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ratio, setRatio] = useState<string>('16:9');
  const [fov, setFov] = useState(initialView.fov);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const size = panoramaCaptureSize(ratio);
  const url = host.media.url(hash);
  useEffect(() => {
    let closed = false;
    const abort = new AbortController();
    let renderer: Three.WebGLRenderer | undefined;
    let texture: Three.Texture | undefined;
    let bitmap: ImageBitmap | undefined;
    let observer: ResizeObserver | undefined;
    async function load() {
      try {
        const three = await import('three');
        if (closed) return;
        renderer = new three.WebGLRenderer({ antialias: true });
        const response = await fetch(url, { signal: abort.signal });
        if (!response.ok) throw new Error('无法加载全景纹理');
        const blob = await response.blob();
        bitmap = await createImageBitmap(blob, { imageOrientation: 'flipY' });
        if (closed) {
          bitmap.close();
          return;
        }
        const limit = renderer.capabilities.maxTextureSize;
        if (Math.max(bitmap.width, bitmap.height) > limit) {
          const scale = limit / Math.max(bitmap.width, bitmap.height);
          const original = bitmap;
          bitmap = await createImageBitmap(blob, {
            imageOrientation: 'flipY',
            resizeWidth: Math.max(1, Math.floor(original.width * scale)),
            resizeHeight: Math.max(1, Math.floor(original.height * scale)),
          });
          original.close();
        }
        if (closed) {
          bitmap.close();
          return;
        }
        texture = new three.CanvasTexture(bitmap);
        texture.mapping = three.EquirectangularReflectionMapping;
        texture.colorSpace = three.SRGBColorSpace;
        const scene = new three.Scene();
        scene.background = texture;
        const camera = new three.PerspectiveCamera(75, 1, 0.1, 10);
        const element = container.current!;
        const activeRenderer = renderer;
        element.appendChild(activeRenderer.domElement);
        const render = (next: View) => {
          const direction = panoramaDirection(next.yaw, next.pitch);
          camera.lookAt(direction.x, direction.y, direction.z);
          camera.fov = next.fov;
          camera.updateProjectionMatrix();
          activeRenderer.render(scene, camera);
        };
        runtime.current = { three, renderer, camera, render };
        observer = new ResizeObserver(() => {
          const w = element.clientWidth || 640,
            h = element.clientHeight || 360;
          activeRenderer.setSize(w, h);
          camera.aspect = w / h;
          render(view.current);
        });
        observer.observe(element);
        render(view.current);
        setReady(true);
        setStatus('拖动或使用方向键环顾，滚轮调整视场角');
      } catch (error) {
        if (!closed) setStatus(error instanceof Error ? error.message : '全景加载失败');
      }
    }
    void load();
    return () => {
      closed = true;
      abort.abort();
      observer?.disconnect();
      runtime.current = null;
      texture?.dispose();
      bitmap?.close();
      renderer?.dispose();
      renderer?.forceContextLoss();
      renderer?.domElement.remove();
    };
  }, [url]);

  function update(patch: Partial<View>) {
    view.current = { ...view.current, ...patch };
    view.current.pitch = Math.max(-85, Math.min(85, view.current.pitch));
    view.current.fov = Math.max(25, Math.min(110, view.current.fov));
    setFov(view.current.fov);
    runtime.current?.render(view.current);
  }

  async function capture(four: boolean) {
    const active = runtime.current;
    if (!active || busy) return;
    setBusy(true);
    const { renderer, camera, three } = active;
    const previousAspect = camera.aspect;
    const previousTarget = renderer.getRenderTarget();
    const target = new three.WebGLRenderTarget(size.width, size.height);
    target.texture.colorSpace = three.SRGBColorSpace;
    try {
      const captures: { title: string; version: CanvasMediaVersion }[] = [];
      for (const yaw of four ? [0, 90, 180, 270] : [view.current.yaw]) {
        const next = four ? { yaw, pitch: 0, fov: 90 } : view.current;
        camera.aspect = size.width / size.height;
        renderer.setRenderTarget(target);
        active.render(next);
        const pixels = new Uint8Array(size.width * size.height * 4);
        renderer.readRenderTargetPixels(target, 0, 0, size.width, size.height, pixels);
        const canvas = document.createElement('canvas');
        canvas.width = size.width;
        canvas.height = size.height;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('无法编码截图');
        const image = context.createImageData(size.width, size.height);
        const stride = size.width * 4;
        for (let y = 0; y < size.height; y++)
          image.data.set(
            pixels.subarray((size.height - y - 1) * stride, (size.height - y) * stride),
            y * stride,
          );
        context.putImageData(image, 0, 0);
        const blob = await new Promise<Blob>((resolve, reject) =>
          canvas.toBlob(
            (blob) => (blob ? resolve(blob) : reject(new Error('截图编码失败'))),
            'image/png',
          ),
        );
        const media = await host.media.upload(blob);
        captures.push({
          title: four ? `全景 ${yaw}°` : '全景当前视角',
          version: {
            sha256: media.sha256,
            mime: 'image/png',
            width: size.width,
            height: size.height,
            createdAt: new Date().toISOString(),
          },
        });
      }
      store
        .getState()
        .apply((document) => createPanoramaCaptures(registry, document, nodeId, hash, captures));
    } catch (error) {
      store.getState().notify(error instanceof Error ? error.message : '截取失败');
    } finally {
      target.dispose();
      camera.aspect = previousAspect;
      renderer.setRenderTarget(previousTarget);
      active.render(view.current);
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent
        aria-describedby={undefined}
        className="nodrag nopan z-[100] max-h-[calc(100%-2rem)] overflow-auto sm:max-w-4xl"
      >
        <DialogTitle>720° 全景查看</DialogTitle>
        <div
          ref={container}
          role="application"
          aria-label="全景视角"
          tabIndex={0}
          className="h-[45vh] min-h-48 w-full touch-none overflow-hidden rounded-md bg-canvas outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            drag.current = { x: event.clientX, y: event.clientY };
          }}
          onPointerUp={() => {
            drag.current = null;
          }}
          onPointerCancel={() => {
            drag.current = null;
          }}
          onPointerMove={(event) => {
            if (!drag.current) return;
            update({
              yaw: view.current.yaw - (event.clientX - drag.current.x) * 0.2,
              pitch: view.current.pitch + (event.clientY - drag.current.y) * 0.2,
            });
            drag.current = { x: event.clientX, y: event.clientY };
          }}
          onWheel={(event) => {
            event.stopPropagation();
            update({ fov: view.current.fov + event.deltaY * 0.05 });
          }}
          onKeyDown={(event) => {
            const steps: Record<string, Partial<View>> = {
              ArrowLeft: { yaw: view.current.yaw - 5 },
              ArrowRight: { yaw: view.current.yaw + 5 },
              ArrowUp: { pitch: view.current.pitch + 5 },
              ArrowDown: { pitch: view.current.pitch - 5 },
            };
            if (steps[event.key]) {
              event.preventDefault();
              event.stopPropagation();
              update(steps[event.key]);
            }
          }}
        />
        <p role="status" className="text-xs text-muted-foreground">
          {status} · FOV {Math.round(fov)}°
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => update(initialView)}>
            重置视角
          </Button>
          <label className="text-sm">
            截图比例{' '}
            <select
              aria-label="截图比例"
              className="rounded-md border bg-background p-2"
              value={ratio}
              onChange={(event) => setRatio(event.target.value)}
            >
              {panoramaRatios.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </label>
          <Button disabled={!ready || busy} onClick={() => void capture(false)}>
            截取当前视角
          </Button>
          <Button disabled={!ready || busy} onClick={() => void capture(true)}>
            四向截取
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          本地截图免费 · {size.width}×{size.height}。
          {panoramaResolutionHint(width, size.width, size.height, fov)}
        </p>
      </DialogContent>
    </Dialog>
  );
}
