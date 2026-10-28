import { useId } from 'react';
import { effectiveVideoParams, type SemanticParamKey, type Value } from '@frame-loom/contracts';
import { Input } from '@frame-loom/ui/components/input';
import { Slider } from '@frame-loom/ui/components/slider';
import { ToggleGroup, ToggleGroupItem } from '@frame-loom/ui/components/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@frame-loom/ui/components/tooltip';
import type { CapabilityParamsProps } from './types';

export function VideoParams(props: CapabilityParamsProps) {
  const id = useId();
  const { capability: cap, protocol, params, inputs, onChange } = props;
  if (cap.kind !== 'video') return null;
  const disabled = props.disabled || props.readOnly;
  const options = effectiveVideoParams(cap, protocol, props.mode ?? cap.defaultMode, inputs);
  const choices = (
    label: string,
    key: SemanticParamKey,
    options: { value: Value; disabled: boolean; reason?: string }[],
    fallback?: Value,
  ) => {
    const reasons = [
      ...new Set(options.flatMap((item) => (item.disabled && item.reason ? [item.reason] : []))),
    ];
    return (
      options.length > 0 && (
        <section className="space-y-2" aria-label={label}>
          <h3 className="text-muted-foreground">{label}</h3>
          <ToggleGroup
            type="single"
            aria-label={label}
            value={String(params[key] ?? fallback ?? '')}
            disabled={disabled}
            className="flex w-full flex-wrap gap-2"
            onValueChange={(value) => {
              const item = options.find((item) => String(item.value) === value);
              if (item && !item.disabled) onChange({ ...params, [key]: item.value });
            }}
          >
            {options.map((item) => (
              <Tooltip key={String(item.value)}>
                <TooltipTrigger asChild>
                  <span tabIndex={item.disabled ? 0 : undefined} className="min-w-0">
                    <ToggleGroupItem
                      value={String(item.value)}
                      disabled={disabled || item.disabled}
                      aria-label={`${label} ${String(item.value)}`}
                      aria-describedby={
                        item.reason ? `${id}-${key}-${reasons.indexOf(item.reason)}` : undefined
                      }
                      className="h-10 border px-3 text-xs"
                    >
                      {item.value === -1
                        ? '自动'
                        : typeof item.value === 'boolean'
                          ? item.value
                            ? '开启'
                            : '关闭'
                          : String(item.value)}
                    </ToggleGroupItem>
                  </span>
                </TooltipTrigger>
                {item.reason && <TooltipContent>{item.reason}</TooltipContent>}
              </Tooltip>
            ))}
          </ToggleGroup>
          {reasons.map((reason, index) => (
            <p key={reason} id={`${id}-${key}-${index}`} className="text-muted-foreground">
              {reason}
            </p>
          ))}
        </section>
      )
    );
  };
  return (
    <div className="space-y-5 text-xs">
      {choices('比例', 'aspectRatio', options.aspectRatios, cap.defaultAspectRatio)}
      {cap.duration.kind === 'range' ? (
        <section className="space-y-3">
          <h3>
            时长：
            {params.duration === -1 ? '自动' : `${params.duration ?? cap.duration.default} 秒`}
          </h3>
          <Slider
            aria-label="时长"
            min={cap.duration.min}
            max={cap.duration.max}
            step={cap.duration.step}
            disabled={
              disabled ||
              options.durations.filter((item) => item.value !== -1).every((item) => item.disabled)
            }
            value={[
              params.duration === -1
                ? cap.duration.default
                : (params.duration ?? cap.duration.default),
            ]}
            onValueChange={([value]) => {
              if (!options.durations.find((item) => item.value === value)?.disabled)
                onChange({ ...params, duration: value });
            }}
          />
          {cap.duration.allowAuto &&
            choices(
              '自动时长',
              'duration',
              options.durations.filter((item) => item.value === -1),
            )}
        </section>
      ) : (
        choices(
          '时长',
          'duration',
          options.durations,
          cap.duration.kind === 'auto' ? -1 : cap.duration.default,
        )
      )}
      {choices('分辨率', 'resolution', options.resolutions, cap.defaultResolution)}
      {cap.audio.mode === 'optional' ? (
        choices('声音', 'audio', options.audio, cap.audio.default)
      ) : (
        <p className="text-muted-foreground">
          声音：
          {cap.audio.mode === 'on' ? '固定有声' : cap.audio.mode === 'off' ? '固定无声' : '未确认'}
        </p>
      )}
      {cap.watermark &&
        choices(
          '水印',
          'watermark',
          [true, false].map((value) => ({ value, disabled: false })),
          cap.watermark.default,
        )}
      {cap.seed && (
        <label className="block space-y-1">
          随机种子
          <Input
            aria-label="随机种子"
            type="number"
            min={0}
            disabled={disabled}
            value={params.seed ?? ''}
            onChange={(event) => {
              const next = { ...params };
              if (event.target.value) next.seed = Number(event.target.value);
              else delete next.seed;
              onChange(next);
            }}
          />
        </label>
      )}
    </div>
  );
}
