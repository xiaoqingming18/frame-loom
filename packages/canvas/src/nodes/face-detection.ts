import type { CanvasFaceBox } from './image-emotion';

type Result = { faces: CanvasFaceBox[]; imageWidth: number; imageHeight: number };
type Request = {
  resolve: (value: Result) => void;
  reject: (error: Error) => void;
  cleanup: () => void;
};

let worker: Worker | undefined;
let sequence = 0;
const pending = new Map<number, Request>();

export async function detectFaces(dataUrl: string, signal: AbortSignal): Promise<Result> {
  signal.throwIfAborted();
  const response = await fetch(dataUrl, { signal });
  if (!response.ok) throw new Error('无法读取源图片');
  const image = await createImageBitmap(await response.blob());
  if (signal.aborted) {
    image.close();
    signal.throwIfAborted();
  }
  const id = ++sequence;
  const detector = getWorker();
  return new Promise((resolve, reject) => {
    const abort = () => {
      if (!pending.has(id)) return;
      pending.delete(id);
      cleanup();
      reject(new DOMException('人脸检测已取消', 'AbortError'));
    };
    const cleanup = () => signal.removeEventListener('abort', abort);
    pending.set(id, {
      resolve: (value) => {
        cleanup();
        resolve(value);
      },
      reject: (error) => {
        cleanup();
        reject(error);
      },
      cleanup,
    });
    signal.addEventListener('abort', abort, { once: true });
    try {
      detector.postMessage({ id, image }, [image]);
    } catch (error) {
      pending.delete(id);
      cleanup();
      image.close();
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./face-detection/worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (
    event: MessageEvent<{
      id: number;
      faces?: CanvasFaceBox[];
      imageWidth?: number;
      imageHeight?: number;
      error?: string;
    }>,
  ) => {
    const request = pending.get(event.data.id);
    if (!request) return;
    pending.delete(event.data.id);
    if (event.data.error) request.reject(new Error(event.data.error));
    else
      request.resolve({
        faces: event.data.faces ?? [],
        imageWidth: event.data.imageWidth ?? 0,
        imageHeight: event.data.imageHeight ?? 0,
      });
  };
  worker.onerror = (event) => {
    const error = new Error(event.message || '人脸检测 Worker 加载失败');
    pending.forEach((request) => request.reject(error));
    pending.clear();
    worker?.terminate();
    worker = undefined;
  };
  return worker;
}
