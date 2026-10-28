import {
  Suspense,
  lazy,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { ImageEditRecipe, imageEditCapabilityIssue } from '@frame-loom/contracts';
import { Button } from '@frame-loom/ui/components/button';
import { Dialog, DialogContent, DialogTitle } from '@frame-loom/ui/components/dialog';
import { useCanvas } from '../context';
import { createImageEditChild } from '../commands/commands';
import type { CanvasGenerationModel } from '../host';
import {
  buildEmotionPrompt,
  neutralEmotionPreset,
  emotionPresetAt,
  resolveEditRegion,
  type CanvasFaceBox,
  type CanvasEmotionPreset,
} from './image-emotion';
import { detectFaces } from './face-detection';

const EmotionHeadPreview = lazy(() =>
  import('./emotion-head-preview').then((module) => ({ default: module.EmotionHeadPreview })),
);

export function EmotionWorkspace({
  nodeId,
  sourceHash,
  imageUrl,
  width,
  height,
  models,
  selectedModel,
  onClose,
}: {
  nodeId: string;
  sourceHash: string;
  imageUrl: string;
  width: number;
  height: number;
  models: CanvasGenerationModel[];
  selectedModel?: CanvasGenerationModel;
  onClose: () => void;
}) {
  const { host, registry, store } = useCanvas();
  const [faces, setFaces] = useState<CanvasFaceBox[]>([]);
  const [selectedFace, setSelectedFace] = useState<CanvasFaceBox | null>(null);
  const [preset, setPreset] = useState<CanvasEmotionPreset>(neutralEmotionPreset);
  const [manual, setManual] = useState(false);
  const [draft, setDraft] = useState<CanvasFaceBox | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [modelId, setModelId] = useState(selectedModel?.id ?? '');
  const [detectionAttempt, setDetectionAttempt] = useState(0);
  const controller = useRef<AbortController | null>(null);
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const model = models.find((item) => item.id === modelId);
  const capabilityIssue = model?.profile
    ? imageEditCapabilityIssue(
        ImageEditRecipe.parse({
          version: 1,
          operation: 'emotion',
          source: { nodeId, sha256: sourceHash },
          targetFace: { x: 0, y: 0, width: 1, height: 1 },
          editRegion: { x: 0, y: 0, width: 1, height: 1 },
          imageWidth: 1,
          imageHeight: 1,
          presetId: preset.id,
          intimacy: preset.intimacy,
          arousal: preset.arousal,
          characterName: '角色1',
          maskMode: model.profile.imageEditCapabilities?.mask ? 'provider' : 'local',
        }),
        model.profile.imageEditCapabilities,
      )
    : undefined;

  useEffect(() => {
    const abort = new AbortController();
    void detectFaces(imageUrl, abort.signal)
      .then((result) => {
        if (abort.signal.aborted) return;
        if (result.imageWidth !== width || result.imageHeight !== height) {
          setError('图片尺寸已变化，请重新打开表情编辑');
          return;
        }
        setFaces(result.faces);
        setError(result.faces.length ? '' : '未识别到人脸，可手动框选');
      })
      .catch((cause: unknown) => {
        if (!(cause instanceof DOMException && cause.name === 'AbortError'))
          setError(`${cause instanceof Error ? cause.message : '人脸检测失败'}，可手动框选`);
      });
    return () => {
      abort.abort();
      controller.current?.abort();
    };
  }, [height, imageUrl, width, detectionAttempt]);

  const pointerBox = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(width, ((event.clientX - rect.left) / rect.width) * width)),
      y: Math.max(0, Math.min(height, ((event.clientY - rect.top) / rect.height) * height)),
    };
  };

  async function submit() {
    if (!selectedFace || !model?.profile || !host.generation) return;
    const current = store.getState().document.nodes.find((node) => node.id === nodeId);
    const currentData = current?.data as {
      versions?: { sha256: string }[];
      activeVersion?: number;
    };
    if (currentData?.versions?.[currentData.activeVersion ?? -1]?.sha256 !== sourceHash) {
      setError('源图片版本已变化，请重新选择');
      return;
    }
    const maskSupported = !!model.profile.imageEditCapabilities?.mask;
    const recipeBase = {
      version: 1 as const,
      operation: 'emotion' as const,
      source: { nodeId, sha256: sourceHash },
      targetFace: {
        x: selectedFace.x,
        y: selectedFace.y,
        width: selectedFace.width,
        height: selectedFace.height,
      },
      editRegion: { x: 0, y: 0, width, height },
      imageWidth: width,
      imageHeight: height,
      presetId: preset.id,
      intimacy: preset.intimacy,
      arousal: preset.arousal,
      characterName: '角色1',
      maskMode: maskSupported ? ('provider' as const) : ('local' as const),
    };
    const base = ImageEditRecipe.safeParse(recipeBase);
    if (!base.success) {
      setError('表情编辑参数无效');
      return;
    }
    const issue = imageEditCapabilityIssue(base.data, model.profile.imageEditCapabilities);
    if (issue) {
      setError(issue);
      return;
    }
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setError('');
    try {
      const editRegion = resolveEditRegion(selectedFace, width, height);
      const state = store.getState();
      const latest = state.document.nodes.find((node) => node.id === nodeId);
      const latestData = latest?.data as {
        versions?: { sha256: string }[];
        activeVersion?: number;
      };
      if (latestData?.versions?.[latestData.activeVersion ?? -1]?.sha256 !== sourceHash)
        throw new Error('源图片版本已变化，请重新选择');
      const recipe = ImageEditRecipe.parse({
        ...recipeBase,
        editRegion,
      });
      const prompt = buildEmotionPrompt(
        {
          presetId: preset.id,
          intimacy: preset.intimacy,
          arousal: preset.arousal,
          characterName: '角色1',
          faceBox: selectedFace,
        },
        editRegion,
      );
      const before = state.document.nodes.length;
      if (
        !state.apply((document) =>
          createImageEditChild(registry, document, nodeId, recipe, prompt, model.id),
        )
      )
        throw new Error('创建表情编辑节点失败');
      const child = store.getState().document.nodes[before];
      store.getState().select([child.id]);
      const job = await host.generation.create({
        modelId: model.id,
        mode: 'reference',
        prompt,
        params: {},
        inputs: [{ kind: 'image', role: 'reference', sha256: sourceHash }],
        imageEdit: recipe,
        source: 'canvas',
      });
      store.getState().setGenerationJob(job);
      store.getState().applySystem((document) => ({
        ...document,
        nodes: document.nodes.map((node) =>
          node.id === child.id
            ? {
                ...node,
                data: { ...(node.data as Record<string, unknown>), pendingJobIds: [job.id] },
              }
            : node,
        ),
      }));
      onClose();
      if (!maskSupported) store.getState().notify('当前模型不支持蒙版，结果将由本地按脸部区域融合');
    } catch (cause) {
      if (!(cause instanceof DOMException && cause.name === 'AbortError'))
        setError(cause instanceof Error ? cause.message : '表情生成准备失败');
    } finally {
      controller.current = null;
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent
        showCloseButton={false}
        aria-describedby={undefined}
        className="nodrag nopan z-[100] flex max-h-[calc(100%-2rem)] flex-col gap-3 overflow-auto bg-popover p-4 text-popover-foreground shadow-panel sm:max-w-[52rem]"
      >
        <header className="flex items-center justify-between">
          <DialogTitle className="text-sm font-semibold">表情编辑工作区</DialogTitle>
          <Button
            variant="ghost"
            size="icon"
            aria-label="关闭表情编辑"
            disabled={busy}
            onClick={onClose}
          >
            ×
          </Button>
        </header>
        <div className="grid min-h-0 gap-4 md:grid-cols-[minmax(0,1fr)_18rem]">
          <div className="space-y-2">
            <div
              className="relative mx-auto max-h-[min(52vh,30rem)] w-full overflow-hidden rounded-sm border bg-muted"
              style={{ aspectRatio: `${width}/${height}`, touchAction: manual ? 'none' : 'auto' }}
              onPointerDown={(event) => {
                if (!manual) return;
                event.currentTarget.setPointerCapture(event.pointerId);
                dragStart.current = pointerBox(event);
                setDraft({
                  ...pointerBox(event),
                  width: 1,
                  height: 1,
                  source: 'manual',
                  id: 'manual',
                });
              }}
              onPointerMove={(event) => {
                if (
                  !manual ||
                  !dragStart.current ||
                  !event.currentTarget.hasPointerCapture(event.pointerId)
                )
                  return;
                const point = pointerBox(event);
                const start = dragStart.current;
                setDraft({
                  id: 'manual',
                  source: 'manual',
                  x: Math.min(start.x, point.x),
                  y: Math.min(start.y, point.y),
                  width: Math.abs(point.x - start.x),
                  height: Math.abs(point.y - start.y),
                });
              }}
              onPointerUp={() => {
                if (draft && draft.width >= width * 0.02 && draft.height >= height * 0.02) {
                  setSelectedFace(draft);
                  setFaces((current) => [...current, draft]);
                  setManual(false);
                }
                dragStart.current = null;
              }}
            >
              <img
                src={imageUrl}
                alt="选择要编辑表情的角色"
                draggable={false}
                className="absolute inset-0 size-full object-fill"
              />
              <svg
                viewBox={`0 0 ${width} ${height}`}
                preserveAspectRatio="none"
                className="absolute inset-0 size-full"
              >
                {faces.map((face) => (
                  <rect
                    key={face.id}
                    x={face.x}
                    y={face.y}
                    width={face.width}
                    height={face.height}
                    fill="none"
                    stroke={selectedFace?.id === face.id ? 'var(--primary)' : 'var(--brand)'}
                    strokeWidth={Math.max(2, width / 300)}
                    onClick={(event) => {
                      event.stopPropagation();
                      setSelectedFace(face);
                    }}
                  />
                ))}
                {draft && (
                  <rect
                    x={draft.x}
                    y={draft.y}
                    width={draft.width}
                    height={draft.height}
                    fill="none"
                    stroke="var(--primary)"
                    strokeDasharray="8 6"
                    strokeWidth={Math.max(2, width / 300)}
                  />
                )}
              </svg>
            </div>
            {error && (
              <p role="alert" className="text-xs text-destructive">
                {error}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setManual(true);
                  setSelectedFace(null);
                  setError('在图片上拖动框选一张脸');
                }}
              >
                {manual ? '拖动图片框选' : '手动框选'}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => setDetectionAttempt((current) => current + 1)}
              >
                重新检测
              </Button>
            </div>
          </div>
          <div className="flex flex-col gap-3">
            <Suspense
              fallback={
                <div className="grid min-h-44 place-items-center rounded-sm border bg-muted text-xs text-muted-foreground">
                  加载 3D 预览…
                </div>
              }
            >
              <EmotionHeadPreview preset={preset} />
            </Suspense>
            <label className="grid gap-1 text-xs">
              模型
              <select
                aria-label="表情模型"
                className="h-8 rounded-md border bg-background px-2"
                value={model?.id ?? ''}
                onChange={(event) => setModelId(event.target.value)}
              >
                <option value="">选择兼容模型</option>
                {models.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <p className="text-xs text-muted-foreground">
              {faces.length ? `${faces.length} 张脸，选择一位角色` : '没有检测到人脸'}
            </p>
            {capabilityIssue && (
              <p role="alert" className="text-xs text-destructive">
                {capabilityIssue}
              </p>
            )}
            <div role="radiogroup" aria-label="目标角色" className="flex flex-wrap gap-1">
              {faces.map((face, index) => (
                <Button
                  key={face.id}
                  size="sm"
                  variant={selectedFace?.id === face.id ? 'default' : 'outline'}
                  role="radio"
                  aria-checked={selectedFace?.id === face.id}
                  onClick={() => setSelectedFace(face)}
                >
                  角色{index + 1}
                </Button>
              ))}
            </div>
            <div
              role="grid"
              aria-label="情绪选择"
              className="grid aspect-square w-full grid-cols-5 grid-rows-5 gap-1"
            >
              {[2, 1, 0, -1, -2].flatMap((arousal) =>
                [-2, -1, 0, 1, 2].map((intimacy) => {
                  const item = emotionPresetAt(intimacy, arousal);
                  return (
                    <button
                      key={`${intimacy}:${arousal}`}
                      type="button"
                      role="gridcell"
                      aria-selected={preset.id === item.id}
                      aria-label={`${item.label}，亲密度 ${intimacy}，激活度 ${arousal}`}
                      title={item.label}
                      onClick={() => setPreset(item)}
                      onKeyDown={(event) => {
                        const moves: Record<string, [number, number]> = {
                          ArrowLeft: [-1, 0],
                          ArrowRight: [1, 0],
                          ArrowUp: [0, 1],
                          ArrowDown: [0, -1],
                        };
                        const move = moves[event.key];
                        if (!move) return;
                        event.preventDefault();
                        const nextIntimacy = Math.max(-2, Math.min(2, intimacy + move[0]));
                        const nextArousal = Math.max(-2, Math.min(2, arousal + move[1]));
                        const next = emotionPresetAt(nextIntimacy, nextArousal);
                        setPreset(next);
                        event.currentTarget.parentElement
                          ?.querySelectorAll<HTMLButtonElement>('[role="gridcell"]')
                          [(2 - nextArousal) * 5 + nextIntimacy + 2]?.focus();
                      }}
                      className={`min-h-8 rounded-sm border px-1 text-[10px] ${preset.id === item.id ? 'border-ring bg-accent-active text-foreground' : 'bg-background text-muted-foreground hover:bg-accent'}`}
                    >
                      {item.label}
                    </button>
                  );
                }),
              )}
            </div>
            <div className="mt-auto flex justify-end gap-2">
              <Button variant="outline" disabled={busy} onClick={onClose}>
                取消
              </Button>
              <Button
                disabled={!selectedFace || !model?.profile || !!capabilityIssue || busy}
                onClick={() => void submit()}
              >
                {busy ? '准备中…' : '生成表情'}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
