import {
  IMAGE_ASPECT_RATIOS,
  IMAGE_RESOLUTIONS,
  IMAGE_QUALITIES,
  IMAGE_BACKGROUNDS,
  IMAGE_PARAM_LABELS,
  IMAGE_QUALITY_LABELS,
  IMAGE_BACKGROUND_LABELS,
  imageRequestSize,
  type ModelProfile,
  type GenerationRequest,
} from '@frame-loom/contracts';
import { Input } from '@frame-loom/ui/components/input';
import { NativeSelect } from '@frame-loom/ui/components/native-select';
import { Slider } from '@frame-loom/ui/components/slider';
import { ToggleGroup, ToggleGroupItem } from '@frame-loom/ui/components/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@frame-loom/ui/components/tooltip';

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
}: {
  profile: ModelProfile;
  params: Params;
  disabled: boolean;
  onChange: (key: string, value: Params[string]) => void;
}) {
  let pixels: string | undefined;
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
        <details>
          <summary className="cursor-pointer rounded-sm text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring">
            更多
          </summary>
          <div className="mt-3 space-y-3">
            {profile.params
              .filter((param) => profile.kind !== 'image' || !(param.key in groups))
              .map((param) => (
                <label key={param.key} className="flex items-center justify-between gap-3">
                  <span>{param.name}</span>
                  {param.type === 'enum' ? (
                    <NativeSelect
                      aria-label={param.name}
                      disabled={disabled}
                      value={String(params[param.key] ?? param.default)}
                      onChange={(event) =>
                        onChange(
                          param.key,
                          param.values!.find((value) => String(value) === event.target.value)!,
                        )
                      }
                      className="w-auto max-w-48"
                    >
                      {param.values?.map((value) => (
                        <option key={String(value)} value={String(value)}>
                          {String(value)}
                        </option>
                      ))}
                    </NativeSelect>
                  ) : param.type === 'boolean' ? (
                    <input
                      type="checkbox"
                      aria-label={param.name}
                      disabled={disabled}
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
                </label>
              ))}
          </div>
        </details>
      )}
      {pixels && (
        <p aria-label="预计像素" className="border-t pt-3 text-muted-foreground">
          ≈ {pixels}
        </p>
      )}
    </div>
  );
}
