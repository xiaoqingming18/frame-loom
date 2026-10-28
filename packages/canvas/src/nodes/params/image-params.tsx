import { resolveImageSize, type SemanticParams } from '@frame-loom/contracts';
import { Input } from '@frame-loom/ui/components/input';
import { Slider } from '@frame-loom/ui/components/slider';
import { Switch } from '@frame-loom/ui/components/switch';
import { ToggleGroup, ToggleGroupItem } from '@frame-loom/ui/components/toggle-group';
import type { CapabilityParamsProps } from './types';

export function ImageParams(props: CapabilityParamsProps) {
  const { capability: cap, protocol, params, inputs, onChange } = props;
  if (cap.kind !== 'image') return null;
  const disabled = props.disabled || props.readOnly;
  const set = (change: Partial<SemanticParams>) => onChange({ ...params, ...change });
  const tiers = cap.size.tiers.filter((tier) => tier.enabled);
  const tier = tiers.find((tier) => tier.name === (params.tier ?? cap.size.default.tier));
  const result = resolveImageSize(cap, params, inputs.length > 0);
  const choices = (
    label: string,
    key: 'tier' | 'aspectRatio' | 'outputFormat' | 'background',
    values: string[],
    value?: string,
  ) =>
    values.length > 0 && (
      <section aria-label={label} className="space-y-2">
        <h3 className="text-muted-foreground">{label}</h3>
        <ToggleGroup
          type="single"
          aria-label={label}
          value={value ?? ''}
          disabled={disabled}
          onValueChange={(value) => {
            if (!value) return;
            const next = { ...params, [key]: value };
            if (key === 'tier') {
              const entry = tiers.find((tier) => tier.name === value);
              if (!entry?.ratios.some((item) => item.ratio === next.aspectRatio))
                next.aspectRatio = entry?.ratios[0]?.ratio;
            }
            if (key === 'tier' || key === 'aspectRatio') {
              delete next.width;
              delete next.height;
            }
            onChange(next);
          }}
          className={
            key === 'aspectRatio' ? 'grid w-full grid-cols-4 gap-1' : 'flex w-full flex-wrap gap-1'
          }
        >
          {values.map((value) => (
            <ToggleGroupItem
              key={value}
              value={value}
              aria-label={`${label} ${value}`}
              className="h-12 min-w-12 flex-col gap-1 border px-2 text-xs"
            >
              {key === 'aspectRatio' && (
                <span
                  aria-hidden
                  className="block max-h-4 max-w-6 border border-current"
                  style={{ aspectRatio: value.replace(':', '/'), width: 24 }}
                />
              )}
              {value}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </section>
    );
  return (
    <div className="space-y-4 text-xs">
      {choices(
        '档位',
        'tier',
        tiers.map((tier) => tier.name),
        tier?.name,
      )}
      {choices(
        '比例',
        'aspectRatio',
        tier?.ratios.map((cell) => cell.ratio) ?? [],
        params.aspectRatio ?? cap.size.default.ratio,
      )}
      {cap.size.custom && (
        <fieldset disabled={disabled} className="grid grid-cols-2 gap-2">
          {(['width', 'height'] as const).map((key) => (
            <label key={key}>
              {key === 'width' ? '宽度' : '高度'}
              <Input
                aria-label={key === 'width' ? '自定义宽度' : '自定义高度'}
                type="number"
                min={cap.size.custom?.minEdge}
                max={cap.size.custom?.maxEdge}
                value={params[key] ?? ''}
                onChange={(event) => {
                  const next = { ...params };
                  if (event.target.value) next[key] = Number(event.target.value);
                  else delete next[key];
                  onChange(next);
                }}
              />
            </label>
          ))}
        </fieldset>
      )}
      {result.issue ? (
        <p role="alert" className="text-destructive">
          {result.issue}
        </p>
      ) : (
        <p aria-label="预计像素" className="text-muted-foreground">
          {result.width && result.height
            ? `${result.width}×${result.height}`
            : protocol.sizeRule?.kind === 'provider' ||
                result.wire === 'tier' ||
                result.wire === 'ratio'
              ? '由服务商决定'
              : '自动尺寸'}
        </p>
      )}
      {cap.quality && cap.quality.values.length > 0 && (
        <section className="space-y-2">
          <h3>画质：{params.quality ?? cap.quality.default}</h3>
          <Slider
            aria-label="画质"
            min={0}
            max={Math.max(0, cap.quality.values.length - 1)}
            step={1}
            disabled={disabled || cap.quality.values.length === 1}
            value={[Math.max(0, cap.quality.values.indexOf(params.quality ?? cap.quality.default))]}
            onValueChange={([index]) => set({ quality: cap.quality!.values[index] })}
          />
        </section>
      )}
      {cap.background?.transparent && (
        <label className="flex items-center justify-between gap-2">
          透明背景
          <Switch
            aria-label="透明背景"
            disabled={disabled}
            checked={(params.background ?? cap.background.default) === 'transparent'}
            onCheckedChange={(checked) => set({ background: checked ? 'transparent' : 'auto' })}
          />
        </label>
      )}
      {choices('输出格式', 'outputFormat', cap.outputFormats, params.outputFormat)}
      {cap.compression && (
        <label className="block space-y-1">
          压缩质量
          <Input
            aria-label="压缩质量"
            type="number"
            disabled={disabled}
            min={cap.compression.min}
            max={cap.compression.max}
            value={params.compression ?? ''}
            onChange={(event) => set({ compression: Number(event.target.value) })}
          />
        </label>
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
      {cap.negativePrompt && (
        <label className="block space-y-1">
          负向提示词
          <Input
            aria-label="负向提示词"
            disabled={disabled}
            value={params.negativePrompt ?? ''}
            onChange={(event) => set({ negativePrompt: event.target.value })}
          />
        </label>
      )}
    </div>
  );
}
