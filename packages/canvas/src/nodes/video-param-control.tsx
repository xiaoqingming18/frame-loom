import { Minus, Plus } from 'lucide-react';
import {
  generationParamReason,
  type GenerationRequest,
  type ModelProfile,
} from '@frame-loom/contracts';
import { Button } from '@frame-loom/ui/components/button';
import { Slider } from '@frame-loom/ui/components/slider';
import { ToggleGroup, ToggleGroupItem } from '@frame-loom/ui/components/toggle-group';

export function VideoParamControl({
  param,
  params,
  profile,
  request,
  disabled,
  onChange,
}: {
  param: ModelProfile['params'][number];
  params: GenerationRequest['params'];
  profile: ModelProfile;
  request?: GenerationRequest;
  disabled: boolean;
  onChange: (key: string, value: GenerationRequest['params'][string]) => void;
}) {
  const value = params[param.key] ?? param.default;
  const reason = (next: GenerationRequest['params'][string]) =>
    request ? generationParamReason(profile, request, param.key, next) : undefined;
  const change = (next: GenerationRequest['params'][string]) => {
    if (!disabled && !reason(next)) onChange(param.key, next);
  };
  const ratio = ['ratio', 'aspectRatio', 'aspect_ratio'].includes(param.key);
  if (param.key === 'duration') {
    const values = param.type === 'enum' ? (param.values ?? []) : undefined;
    const index = values ? values.indexOf(value) : Number(value);
    const min = values ? 0 : param.min;
    const max = values ? values.length - 1 : param.max;
    const at = (position: number) => (values ? values[position] : position);
    if (min === undefined || max === undefined) return null;
    return (
      <div className="w-full space-y-3">
        <div className="flex items-center justify-end gap-2">
          <Button
            size="icon"
            variant="ghost"
            aria-label="减少时长"
            className="size-6 rounded-full bg-muted"
            disabled={disabled || index <= min || !!reason(at(index - 1))}
            onClick={() => change(at(index - 1))}
          >
            <Minus aria-hidden="true" className="size-3" />
          </Button>
          <span aria-label="当前时长" className="min-w-10 text-center text-sm">
            {String(value)} <small className="text-muted-foreground">s</small>
          </span>
          <Button
            size="icon"
            variant="ghost"
            aria-label="增加时长"
            className="size-6 rounded-full bg-muted"
            disabled={disabled || index < min || index >= max || !!reason(at(index + 1))}
            onClick={() => change(at(index + 1))}
          >
            <Plus aria-hidden="true" className="size-3" />
          </Button>
        </div>
        <Slider
          aria-label={param.name}
          min={min}
          max={max}
          step={1}
          disabled={disabled || min === max}
          value={[Math.max(min, index)]}
          onValueChange={([next]) => change(at(next))}
        />
        <div className="flex justify-between text-[10px] text-muted-foreground">
          <span>{String(at(min))}s</span>
          <span>{String(at(max))}s</span>
        </div>
        {reason(value) && (
          <p role="alert" className="text-destructive">
            {reason(value)}
          </p>
        )}
      </div>
    );
  }
  return (
    <ToggleGroup
      type="single"
      spacing={2}
      aria-label={param.name}
      value={String(value)}
      onValueChange={(next) => {
        const choice = param.values?.find((item) => String(item) === next);
        if (choice !== undefined) change(choice);
      }}
      className={ratio ? 'grid w-full grid-cols-5 gap-2' : 'flex w-full flex-wrap gap-2'}
    >
      {param.values?.map((option) => {
        const [width, height] = String(option).split(':').map(Number);
        const adaptive = ['adaptive', 'auto'].includes(String(option));
        const blocked = reason(option);
        return (
          <ToggleGroupItem
            key={String(option)}
            value={String(option)}
            aria-label={`${param.name} ${String(option)}`}
            disabled={disabled || !!blocked}
            title={blocked ?? param.notes?.[String(option)]}
            className={`min-w-0 flex-1 flex-col gap-2 rounded-lg border px-2 text-xs data-[state=on]:border-foreground data-[state=on]:bg-card ${ratio ? 'h-20' : 'h-10'}`}
          >
            {ratio && (
              <span aria-hidden="true" className="flex h-6 items-center justify-center">
                <span
                  className="block rounded-xs border border-current"
                  style={{
                    width: adaptive || !width || !height ? 18 : 26 * Math.min(1, width / height),
                    height: adaptive || !width || !height ? 22 : 26 * Math.min(1, height / width),
                  }}
                />
              </span>
            )}
            <span>{adaptive ? '自适应' : String(option)}</span>
          </ToggleGroupItem>
        );
      })}
    </ToggleGroup>
  );
}
