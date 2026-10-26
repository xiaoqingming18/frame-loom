import { useState } from 'react';
import { ArrowUp, ChevronDown, Copy, Expand, Minimize2 } from 'lucide-react';
import {
  IMAGE_PARAM_LABELS,
  IMAGE_QUALITY_LABELS,
  IMAGE_BACKGROUND_LABELS,
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
import { useCanvas } from '../context';
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
        className="nodrag nopan nowheel w-full overflow-hidden rounded-2xl border bg-card text-foreground shadow-panel focus-within:border-ring"
      >
        <div className="flex items-center justify-between gap-3 px-4 pt-3">
          <div aria-label="参考素材" className="flex min-w-0 items-center gap-2 overflow-x-auto">
            {!inputs.length && (
              <span className="text-xs text-muted-foreground">连入素材作为参考</span>
            )}
            {inputs.map((input, index) => (
              <span
                key={`${index}-${input.sha256}`}
                title={`参考 ${index + 1}`}
                className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted text-xs"
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
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? (
              <Minimize2 aria-hidden="true" className="size-4" />
            ) : (
              <Expand aria-hidden="true" className="size-4" />
            )}
          </Button>
        </div>
        <Textarea
          aria-label="生成提示词"
          disabled={locked}
          value={data.prompt}
          maxLength={profile?.protocol === 'minimax-video-v2' ? 7000 : 32000}
          placeholder="描述你想要生成的内容…"
          className={`min-h-20 resize-none border-0 bg-transparent px-4 py-3 text-sm shadow-none transition-[height] duration-200 focus-visible:ring-0 motion-reduce:transition-none ${expanded ? 'h-[min(260px,35vh)]' : 'h-20'}`}
          onChange={(event) => onPrompt(event.target.value)}
        />
        <div className="flex items-center justify-between px-3 pb-2 text-xs text-muted-foreground">
          <Button
            size="icon"
            variant="ghost"
            aria-label="复制提示词"
            onClick={() => {
              void navigator.clipboard
                .writeText(data.prompt)
                .then(() => store.getState().notify('提示词已复制'))
                .catch(() => store.getState().notify('复制失败，请手动复制提示词'));
            }}
          >
            <Copy aria-hidden="true" className="size-3.5" />
          </Button>
          <span aria-label="提示词字数">{data.prompt.length} 字</span>
        </div>
        <div className="flex flex-wrap items-center gap-1 border-t px-3 py-2">
          <Popover open={modelOpen} onOpenChange={setModelOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                aria-label="生成模型"
                disabled={locked}
                className="max-w-48 gap-1 text-xs"
              >
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
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                aria-label="生成参数"
                disabled={!profile || locked}
                className="min-w-0 flex-1 gap-1 text-xs"
              >
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
            <Popover open={countOpen} onOpenChange={setCountOpen}>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="sm" aria-label="生成数量" disabled={countDisabled}>
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
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                tabIndex={disabledReason ? 0 : undefined}
                className="rounded-full focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Button
                  size="icon"
                  aria-label={`生成${kind === 'image' ? '图片' : '视频'}`}
                  aria-describedby={disabledReason ? `generation-reason-${nodeId}` : undefined}
                  disabled={!!disabledReason}
                  onClick={onGenerate}
                  className="rounded-full"
                >
                  <ArrowUp aria-hidden="true" className="size-4" />
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>{disabledReason ?? '发送生成任务'}</TooltipContent>
          </Tooltip>
        </div>
        {disabledReason && (
          <p id={`generation-reason-${nodeId}`} className="px-4 pb-3 text-xs text-muted-foreground">
            {disabledReason}
          </p>
        )}
      </div>
    </TooltipProvider>
  );
}
