import {
  IMAGE_ASPECT_RATIOS,
  IMAGE_RESOLUTIONS,
  IMAGE_QUALITIES,
  IMAGE_BACKGROUNDS,
  IMAGE_PARAM_LABELS,
  IMAGE_QUALITY_LABELS,
  IMAGE_BACKGROUND_LABELS,
  imageRequestSize,
  generationParamReason,
  type ModelProfile,
  type GenerationRequest,
} from '@frame-loom/contracts';
import { Input } from '@frame-loom/ui/components/input';
import { NativeSelect } from '@frame-loom/ui/components/native-select';
import { Slider } from '@frame-loom/ui/components/slider';
import { ToggleGroup, ToggleGroupItem } from '@frame-loom/ui/components/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@frame-loom/ui/components/tooltip';
import { Popover, PopoverContent, PopoverTrigger } from '@frame-loom/ui/components/popover';
import { Button } from '@frame-loom/ui/components/button';
import { CircleHelp } from 'lucide-react';
import { VideoParamControl } from './video-param-control';

type Params = GenerationRequest['params'];
const groups = {
  aspectRatio: IMAGE_ASPECT_RATIOS,
  resolution: IMAGE_RESOLUTIONS,
  quality: IMAGE_QUALITIES,
  background: IMAGE_BACKGROUNDS,
};

function label(key: string, value: string) {
  if (key === 'quality') return IMAGE_QUALITY_LABELS[value as keyof typeof IMAGE_QUALITY_LABELS];
  if (key === 'background')
    return IMAGE_BACKGROUND_LABELS[value as keyof typeof IMAGE_BACKGROUND_LABELS];
  return value;
}

export function GenerationParams({
  profile,
  params,
  disabled,
  onChange,
  request,
}: {
  profile: ModelProfile;
  params: Params;
  disabled: boolean;
  onChange: (key: string, value: Params[string]) => void;
  request?: GenerationRequest;
}) {
  let pixels: string | undefined;
  const video = profile.kind === 'video';
  const Container = video ? 'div' : 'details';
  // 通用档案可能不声明比例；Gemini 的实际尺寸由供应商决定，不伪造像素值。
  if (profile.kind === 'image' && profile.params.some((param) => param.key === 'aspectRatio'))
    pixels = imageRequestSize(profile, params)?.replace('x', '×');
  return (
    <div className="space-y-4 text-xs">
      {profile.kind === 'image' &&
        Object.entries(groups).map(([key, values]) => {
          const param = profile.params.find((item) => item.key === key);
          if (!param) return null;
          const supported = (value: string) => param.values?.includes(value) === true;
          return (
            <section key={key} aria-label={param.name} className="space-y-2">
              <h3 className="text-muted-foreground">
                {IMAGE_PARAM_LABELS[key as keyof typeof IMAGE_PARAM_LABELS]}
              </h3>
              {key === 'quality' && (
                <Slider
                  aria-label="画质"
                  min={0}
                  max={4}
                  step={1}
                  disabled={disabled}
                  value={[
                    IMAGE_QUALITIES.indexOf(params.quality as (typeof IMAGE_QUALITIES)[number]),
                  ]}
                  onValueChange={([index]) => {
                    const nearest = IMAGE_QUALITIES.reduce(
                      (best, value, current) =>
                        supported(value) && Math.abs(current - index) < Math.abs(best - index)
                          ? current
                          : best,
                      IMAGE_QUALITIES.findIndex((value) => supported(value)),
                    );
                    if (nearest >= 0) onChange(key, IMAGE_QUALITIES[nearest]);
                  }}
                  className="my-3"
                />
              )}
              <ToggleGroup
                type="single"
                aria-label={param.name}
                value={String(params[key])}
                onValueChange={(value) => value && onChange(key, value)}
                className={
                  key === 'aspectRatio' ? 'grid w-full grid-cols-5 gap-1' : 'flex w-full gap-1'
                }
              >
                {values.map((value) => {
                  const [width, height] = value.split(':').map(Number);
                  const note = param.notes?.[value];
                  return (
                    <Tooltip key={value}>
                      <TooltipTrigger asChild>
                        <span
                          className="min-w-0 flex-1 rounded-md focus-visible:ring-2 focus-visible:ring-ring"
                          tabIndex={!supported(value) ? 0 : undefined}
                        >
                          <ToggleGroupItem
                            value={value}
                            disabled={disabled || !supported(value)}
                            aria-label={`${param.name} ${label(key, value)}`}
                            title={!supported(value) ? '当前模型不支持' : note}
                            className={`relative h-auto min-h-8 w-full flex-col gap-1 border border-transparent px-1 py-1.5 text-xs focus-visible:ring-2 focus-visible:ring-ring data-[state=on]:border-ring ${key === 'background' ? 'rounded-full' : 'rounded-md'}`}
                          >
                            {key === 'aspectRatio' && (
                              <span
                                className="flex h-5 items-center justify-center"
                                aria-hidden="true"
                              >
                                <span
                                  className="block rounded-xs border border-current"
                                  style={{
                                    width: 20 * Math.min(1, width / height),
                                    height: 20 * Math.min(1, height / width),
                                  }}
                                />
                              </span>
                            )}
                            <span>{label(key, value)}</span>
                            {note && (
                              <small className="absolute -top-1 -right-1 rounded-sm bg-muted px-1 text-[9px] text-muted-foreground">
                                {note}
                              </small>
                            )}
                          </ToggleGroupItem>
                        </span>
                      </TooltipTrigger>
                      {(!supported(value) || note) && (
                        <TooltipContent>
                          {!supported(value) ? '当前模型不支持' : note}
                        </TooltipContent>
                      )}
                    </Tooltip>
                  );
                })}
              </ToggleGroup>
            </section>
          );
        })}
      {profile.params.some((param) => profile.kind !== 'image' || !(param.key in groups)) && (
        <Container>
          {!video && (
            <summary className="cursor-pointer rounded-sm text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring">
              更多
            </summary>
          )}
          <div className={video ? 'space-y-6' : 'mt-3 space-y-3'}>
            {profile.params
              .filter(
                (param) =>
                  (profile.kind !== 'image' || !(param.key in groups)) &&
                  !(
                    profile.audioParam === param.key &&
                    ['fixed-on', 'fixed-off'].includes(profile.audioOutput ?? '')
                  ),
              )
              .map((param) => (
                <div
                  key={param.key}
                  className={
                    video ? 'flex flex-col gap-2' : 'flex items-center justify-between gap-3'
                  }
                >
                  <span className="flex items-center gap-1 text-muted-foreground">
                    {param.name}
                    {profile.kind === 'video' && (
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`${param.name}说明`}
                            className="size-6"
                          >
                            <CircleHelp aria-hidden="true" className="size-3.5" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent
                          sticky="always"
                          className="max-w-[calc(100vw-32px)] text-xs"
                        >
                          <p>
                            默认值：{String(param.default)}
                            {param.min !== undefined ? `；最小 ${param.min}` : ''}
                            {param.max !== undefined ? `；最大 ${param.max}` : ''}。
                          </p>
                          {Object.entries(param.notes ?? {}).map(([value, note]) => (
                            <p key={value}>
                              {value}：{note}
                            </p>
                          ))}
                          {profile.constraints
                            .filter((rule) => rule.param === param.key)
                            .map((rule, index) => (
                              <p key={index}>{rule.message}</p>
                            ))}
                        </PopoverContent>
                      </Popover>
                    )}
                  </span>
                  {video &&
                  ((param.type === 'enum' &&
                    ['ratio', 'aspectRatio', 'aspect_ratio', 'resolution', 'duration'].includes(
                      param.key,
                    )) ||
                    (param.key === 'duration' &&
                      param.type === 'number' &&
                      param.min !== undefined &&
                      param.max !== undefined)) ? (
                    <VideoParamControl
                      param={param}
                      params={params}
                      profile={profile}
                      request={request}
                      disabled={disabled}
                      onChange={onChange}
                    />
                  ) : param.type === 'enum' ? (
                    <NativeSelect
                      aria-label={param.name}
                      disabled={disabled}
                      value={
                        param.values?.includes(params[param.key] ?? param.default)
                          ? String(params[param.key] ?? param.default)
                          : ''
                      }
                      onChange={(event) =>
                        onChange(
                          param.key,
                          param.values!.find((value) => String(value) === event.target.value)!,
                        )
                      }
                      className="w-auto max-w-48"
                    >
                      <option value="" disabled>
                        请选择
                      </option>
                      {param.values?.map((value) => (
                        <option
                          key={String(value)}
                          value={String(value)}
                          disabled={
                            !!request && !!generationParamReason(profile, request, param.key, value)
                          }
                        >
                          {String(value)}
                          {request && generationParamReason(profile, request, param.key, value)
                            ? `（${generationParamReason(profile, request, param.key, value)}）`
                            : ''}
                        </option>
                      ))}
                    </NativeSelect>
                  ) : param.type === 'boolean' && param.values?.length === 1 ? (
                    <span>{param.values[0] === true ? '固定开启' : '固定关闭'}</span>
                  ) : param.type === 'boolean' ? (
                    <input
                      type="checkbox"
                      aria-label={param.name}
                      disabled={
                        disabled ||
                        (!!request &&
                          !!generationParamReason(
                            profile,
                            request,
                            param.key,
                            params[param.key] !== true,
                          ))
                      }
                      checked={params[param.key] === true}
                      onChange={(event) => onChange(param.key, event.target.checked)}
                    />
                  ) : (
                    <Input
                      aria-label={param.name}
                      disabled={disabled}
                      type={param.type === 'number' ? 'number' : 'text'}
                      min={param.min}
                      max={param.max}
                      value={String(params[param.key] ?? param.default)}
                      onChange={(event) =>
                        onChange(
                          param.key,
                          param.type === 'number' ? Number(event.target.value) : event.target.value,
                        )
                      }
                      className="w-36"
                    />
                  )}
                </div>
              ))}
          </div>
        </Container>
      )}
      {pixels && (
        <p aria-label="预计像素" className="border-t pt-3 text-muted-foreground">
          ≈ {pixels}
        </p>
      )}
      {profile.kind === 'video' && profile.audioOutput && profile.audioOutput !== 'optional' && (
        <p className="border-t pt-3 text-muted-foreground">
          {profile.audioOutput === 'fixed-on'
            ? '声音：固定有声'
            : profile.audioOutput === 'fixed-off'
              ? '声音：固定无声'
              : '声音：接入未声明，不能推断有声输出'}
        </p>
      )}
    </div>
  );
}
