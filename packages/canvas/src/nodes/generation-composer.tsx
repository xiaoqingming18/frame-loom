import { useLayoutEffect, useRef, useState } from 'react';
import {
  ArrowUp,
  ChevronDown,
  Copy,
  Maximize2,
  Minimize2,
  Plus,
  Shapes,
  RectangleHorizontal,
} from 'lucide-react';
import {
  IMAGE_PARAM_LABELS,
  IMAGE_QUALITY_LABELS,
  IMAGE_BACKGROUND_LABELS,
  resolveImagePrompt,
  type CanvasMediaData,
  type GenerationInput,
  type GenerationRequest,
} from '@frame-loom/contracts';
import { Button } from '@frame-loom/ui/components/button';
import { Textarea } from '@frame-loom/ui/components/textarea';
import { Popover, PopoverContent, PopoverTrigger } from '@frame-loom/ui/components/popover';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@frame-loom/ui/components/tooltip';
import type { CanvasGenerationConfig } from '../host';
import { useCanvas, useCanvasState } from '../context';
import { updateData } from '../commands/commands';
import { generationReferences } from './generation-inputs';
import { ImagePromptEditor } from './image-prompt-editor';
import { GenerationParams } from './generation-params';

type Model = CanvasGenerationConfig['models'][number];
type Params = GenerationRequest['params'];

export function GenerationComposer({
  nodeId,
  kind,
  data,
  model,
  options,
  params,
  inputs,
  locked,
  countDisabled,
  disabledReason,
  onGenerate,
  onPrompt,
  onCount,
  onParam,
  onModel,
}: {
  nodeId: string;
  kind: 'image' | 'video';
  data: CanvasMediaData;
  model: Model | undefined;
  options: Model[];
  params: Params;
  inputs: GenerationInput[];
  locked: boolean;
  countDisabled: boolean;
  disabledReason: string | undefined;
  onGenerate: () => void;
  onPrompt: (prompt: string) => void;
  onCount: (count: number) => void;
  onParam: (key: string, value: Params[string]) => void;
  onModel: (id: string) => void;
}) {
  const { host, store } = useCanvas();
  const [expanded, setExpanded] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [countOpen, setCountOpen] = useState(false);
  const document = useCanvasState((state) => state.document);
  const references = generationReferences(document, nodeId);
  const dragged = useRef<string | null>(null);
  const promptEditor = useRef<{ open: () => void }>(null);
  const videoEditor = useRef<HTMLTextAreaElement>(null);
  const composing = useRef(false);
  useLayoutEffect(() => {
    const editor = videoEditor.current;
    if (editor && !composing.current && editor.value !== data.prompt) editor.value = data.prompt;
  }, [data.prompt]);
  function reorderReference(sourceId: string, targetId: string) {
    if (locked || sourceId === targetId) return;
    const order = references.map((reference) => reference.edge.id);
    const from = order.indexOf(sourceId);
    const to = order.indexOf(targetId);
    if (from < 0 || to < 0) return;
    order.splice(to, 0, order.splice(from, 1)[0]);
    store
      .getState()
      .apply((document) =>
        updateData<CanvasMediaData>(document, nodeId, (data) => ({ ...data, inputOrder: order })),
      );
  }
  const profile = model?.profile ?? undefined;
  const summary =
    kind === 'image'
      ? Object.keys(IMAGE_PARAM_LABELS)
          .filter((key) => profile?.params.some((param) => param.key === key))
          .map((key) =>
            key === 'quality'
              ? IMAGE_QUALITY_LABELS[params[key] as keyof typeof IMAGE_QUALITY_LABELS]
              : key === 'background'
                ? IMAGE_BACKGROUND_LABELS[params[key] as keyof typeof IMAGE_BACKGROUND_LABELS]
                : String(params[key]),
          )
          .join(' · ')
      : '视频参数';
  return (
    <TooltipProvider>
      <div
        onKeyDown={(event) => event.stopPropagation()}
        className="nodrag nopan nowheel w-full overflow-hidden rounded-2xl bg-card text-foreground shadow-panel"
      >
        <div className="flex h-16 items-start justify-between gap-3 px-2 pt-2">
          <div aria-label="参考素材" className="flex min-w-0 items-center gap-2 overflow-x-auto">
            {kind === 'image' && (
              <Button
                size="icon"
                variant="ghost"
                aria-label="添加参考"
                disabled={locked}
                className="size-12 shrink-0 rounded-lg border border-dashed text-muted-foreground"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => promptEditor.current?.open()}
              >
                <Plus aria-hidden="true" className="size-4" />
              </Button>
            )}
            {inputs.map((input, index) => (
              <span
                key={references[index].edge.id}
                title={`参考 ${index + 1}`}
                role={kind === 'image' ? 'button' : undefined}
                aria-label={kind === 'image' ? `参考 ${index + 1}，Alt 加方向键排序` : undefined}
                tabIndex={kind === 'image' && !locked ? 0 : undefined}
                draggable={kind === 'image' && !locked}
                onDragStart={(event) => {
                  dragged.current = references[index].edge.id;
                  event.dataTransfer.setData('text/plain', references[index].edge.id);
                  event.stopPropagation();
                }}
                onDragOver={(event) => {
                  if (kind === 'image') {
                    event.preventDefault();
                    event.stopPropagation();
                  }
                }}
                onDrop={(event) => {
                  if (kind !== 'image') return;
                  event.preventDefault();
                  event.stopPropagation();
                  if (dragged.current) reorderReference(dragged.current, references[index].edge.id);
                  dragged.current = null;
                }}
                onDragEnd={() => {
                  dragged.current = null;
                }}
                onKeyDown={(event) => {
                  if (
                    kind !== 'image' ||
                    !event.altKey ||
                    !['ArrowLeft', 'ArrowRight'].includes(event.key)
                  )
                    return;
                  event.preventDefault();
                  const target = references[index + (event.key === 'ArrowLeft' ? -1 : 1)];
                  if (target) reorderReference(references[index].edge.id, target.edge.id);
                }}
                className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-muted text-xs focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                {input.kind === 'image' && input.sha256 ? (
                  <img
                    src={host.media.url(input.sha256)}
                    alt={`参考 ${index + 1}`}
                    draggable={false}
                    className="size-full object-cover"
                  />
                ) : (
                  `${input.kind === 'video' ? '视频' : '音频'} ${index + 1}`
                )}
              </span>
            ))}
          </div>
          <Button
            size="icon"
            variant="ghost"
            aria-label={expanded ? '收起提示词' : '展开提示词'}
            aria-expanded={expanded}
            className="size-7 text-muted-foreground"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? (
              <Minimize2 aria-hidden="true" className="size-4" />
            ) : (
              <Maximize2 aria-hidden="true" className="size-3.5" />
            )}
          </Button>
        </div>
        {kind === 'image' ? (
          <ImagePromptEditor
            ref={promptEditor}
            nodeId={nodeId}
            value={data.prompt}
            disabled={locked}
            expanded={expanded}
            profile={profile}
            onChange={onPrompt}
          />
        ) : (
          <Textarea
            ref={videoEditor}
            aria-label="生成提示词"
            disabled={locked}
            defaultValue={data.prompt}
            maxLength={profile?.protocol === 'minimax-video-v2' ? 7000 : 32000}
            placeholder="描述你想要生成的内容…"
            className={`min-h-0 resize-none rounded-none border-0 bg-transparent px-3.5 py-6 text-sm shadow-none transition-[height] duration-200 ease-in-out focus-visible:ring-0 motion-reduce:transition-none ${expanded ? 'h-[292px]' : 'h-32'}`}
            onCompositionStart={() => {
              composing.current = true;
            }}
            onCompositionEnd={(event) => {
              composing.current = false;
              onPrompt(event.currentTarget.value);
            }}
            onChange={(event) => {
              if (!composing.current) onPrompt(event.target.value);
            }}
          />
        )}
        <div className="flex h-9 items-center justify-end gap-2 px-3.5 text-[10px] text-muted-foreground">
          <Button
            size="icon"
            variant="ghost"
            aria-label="复制提示词"
            className="size-6"
            onClick={() => {
              void navigator.clipboard
                .writeText(data.prompt)
                .then(() => store.getState().notify('提示词已复制'))
                .catch(() => store.getState().notify('复制失败，请手动复制提示词'));
            }}
          >
            <Copy aria-hidden="true" className="size-3.5" />
          </Button>
          <span aria-label="提示词字数">
            {kind === 'image'
              ? resolveImagePrompt(
                  data.prompt,
                  references.map((reference) => reference.node.id),
                ).prompt.length
              : data.prompt.length}{' '}
            / {profile?.protocol === 'minimax-video-v2' ? 7000 : 32000}
          </span>
        </div>
        <div className="flex items-center gap-1 px-3 pb-3">
          <Popover open={modelOpen} onOpenChange={setModelOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                aria-label="生成模型"
                disabled={locked}
                className="h-8 max-w-48 shrink-0 gap-1 px-1 text-xs font-normal"
              >
                <Shapes aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">{model?.label ?? '选择模型'}</span>
                <ChevronDown aria-hidden="true" className="size-3" />
              </Button>
            </PopoverTrigger>
            <PopoverContent
              onKeyDown={(event) => event.stopPropagation()}
              aria-label="生成模型"
              side="top"
              align="start"
              collisionPadding={{ top: 58, right: 16, bottom: 16, left: 16 }}
              className="nodrag nopan nowheel max-h-[min(360px,var(--radix-popover-content-available-height))] w-80 max-w-[calc(100vw-32px)] overflow-y-auto p-2"
            >
              <h3 className="px-2 py-1 text-xs text-muted-foreground">生成模型</h3>
              {options.map((item) => (
                <Button
                  key={item.id}
                  variant="ghost"
                  disabled={!item.profile}
                  aria-pressed={item.id === model?.id}
                  className="h-auto w-full flex-col items-start gap-1 px-2 py-2 text-left"
                  onClick={() => {
                    onModel(item.id);
                    setModelOpen(false);
                  }}
                >
                  <span className="text-xs">{item.label}</span>
                  <span className="text-xs font-normal whitespace-normal text-muted-foreground">
                    {item.profile
                      ? `${item.profile.name} · ${item.profile.modes.map((mode) => mode.name).join(' / ')} · 最多 ${item.profile.inputs.find((input) => input.kind === 'image')?.maxCount ?? 0} 张参考`
                      : '无匹配档案'}
                  </span>
                </Button>
              ))}
              {!options.length && (
                <p className="p-2 text-xs text-muted-foreground">请先在模型服务中启用模型</p>
              )}
            </PopoverContent>
          </Popover>
          <span aria-hidden="true" className="mx-1 h-3 w-px shrink-0 bg-border" />
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                aria-label="生成参数"
                disabled={!profile || locked}
                className="h-8 min-w-0 gap-1 px-1 text-xs font-normal"
              >
                <RectangleHorizontal
                  aria-hidden="true"
                  className="size-3 shrink-0 text-muted-foreground"
                />
                <span className="truncate">{summary || '参数'}</span>
                <ChevronDown aria-hidden="true" className="size-3" />
              </Button>
            </PopoverTrigger>
            <PopoverContent
              onKeyDown={(event) => event.stopPropagation()}
              aria-label="生成参数"
              side="top"
              collisionPadding={{ top: 58, right: 16, bottom: 16, left: 16 }}
              className="nodrag nopan nowheel max-h-[min(440px,var(--radix-popover-content-available-height))] w-[420px] max-w-[calc(100vw-32px)] overflow-y-auto rounded-xl"
            >
              {profile && (
                <GenerationParams
                  profile={profile}
                  params={params}
                  disabled={locked}
                  onChange={onParam}
                />
              )}
            </PopoverContent>
          </Popover>
          {kind === 'image' && (
            <>
              <span aria-hidden="true" className="mx-1 h-3 w-px shrink-0 bg-border" />
              <Popover open={countOpen} onOpenChange={setCountOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label="生成数量"
                    disabled={countDisabled}
                    className="h-8 shrink-0 px-1 text-xs font-normal text-muted-foreground"
                  >
                    ×{data.count ?? 1}
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  onKeyDown={(event) => event.stopPropagation()}
                  aria-label="生成数量"
                  side="top"
                  collisionPadding={{ top: 58, right: 16, bottom: 16, left: 16 }}
                  className="nodrag nopan nowheel w-28 p-1"
                >
                  {[1, 2, 3, 4].map((count) => (
                    <Button
                      key={count}
                      variant="ghost"
                      aria-pressed={(data.count ?? 1) === count}
                      className="w-full"
                      onClick={() => {
                        onCount(count);
                        setCountOpen(false);
                      }}
                    >
                      ×{count}
                    </Button>
                  ))}
                </PopoverContent>
              </Popover>
            </>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                tabIndex={disabledReason ? 0 : undefined}
                className="ml-auto shrink-0 rounded-lg focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Button
                  size="icon"
                  aria-label={`生成${kind === 'image' ? '图片' : '视频'}`}
                  aria-describedby={disabledReason ? `generation-reason-${nodeId}` : undefined}
                  disabled={!!disabledReason}
                  onClick={onGenerate}
                  variant="outline"
                  className="size-8 rounded-lg bg-muted text-muted-foreground shadow-none"
                >
                  <ArrowUp aria-hidden="true" className="size-4" />
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>{disabledReason ?? '发送生成任务'}</TooltipContent>
          </Tooltip>
        </div>
        {disabledReason && (
          <p
            id={`generation-reason-${nodeId}`}
            className={
              disabledReason === '请填写提示词'
                ? 'sr-only'
                : 'px-4 pb-3 text-xs text-muted-foreground'
            }
          >
            {disabledReason}
          </p>
        )}
      </div>
    </TooltipProvider>
  );
}
