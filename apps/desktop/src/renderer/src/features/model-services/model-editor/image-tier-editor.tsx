import { useState } from 'react';
import { defaultTierPixels, type ImageCap, type ProtocolDescriptor } from '@frame-loom/contracts';
import { Button } from '@frame-loom/ui/components/button';
import { Input } from '@frame-loom/ui/components/input';
import { Checkbox } from '@frame-loom/ui/components/checkbox';
import { Choices, NumberField, ToggleField } from './capability-controls';
import { ErrorMessage, Field } from '../form-fields';

const ratios = ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '4:5', '5:4', '21:9'];
export function ImageTierEditor({
  value,
  onChange,
  descriptor,
}: {
  value: ImageCap['size'];
  onChange: (value: ImageCap['size']) => void;
  descriptor: ProtocolDescriptor;
}) {
  const [newTier, setTier] = useState('');
  const [other, setOther] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const rule = descriptor.sizeRule!;
  const update = (index: number, tier: ImageCap['size']['tiers'][number]) =>
    onChange({ ...value, tiers: value.tiers.map((item, i) => (i === index ? tier : item)) });
  function addRatio(index: number, ratio: string) {
    if (!/^[1-9]\d*:[1-9]\d*$/.test(ratio)) {
      setError('比例格式应为 17:11');
      return;
    }
    const tier = value.tiers[index];
    if (tier.ratios.some((item) => item.ratio === ratio)) return;
    const pixels = defaultTierPixels(rule, tier.name, ratio);
    update(index, { ...tier, ratios: [...tier.ratios, { ratio, ...(pixels ? { pixels } : {}) }] });
    setError('');
  }
  return (
    <div className="space-y-4">
      <Choices
        path="size.wire"
        value={value.wire}
        values={descriptor.ceiling.image!.sizeWire}
        onChange={(wire) => onChange({ ...value, wire: wire as ImageCap['size']['wire'] })}
      />
      {value.tiers.map((tier, index) => (
        <article key={index} className="space-y-3 rounded-xl border border-border p-3">
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={tier.enabled}
                onCheckedChange={(enabled) => update(index, { ...tier, enabled: enabled === true })}
              />
              {tier.name}
            </label>
            <Button
              size="xs"
              variant="ghost"
              onClick={() =>
                onChange({ ...value, tiers: value.tiers.filter((_, i) => i !== index) })
              }
            >
              删除档位
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {[...new Set([...ratios, ...tier.ratios.map((item) => item.ratio)])].map((ratio) => {
              const cell = tier.ratios.find((item) => item.ratio === ratio);
              return (
                <div
                  key={ratio}
                  className={`min-w-0 rounded-lg border p-2 ${cell ? 'border-primary bg-accent/40' : 'border-border'}`}
                >
                  <label className="flex items-center gap-2 text-xs">
                    <Checkbox
                      checked={!!cell}
                      aria-label={`${tier.name} ${ratio}`}
                      onCheckedChange={(checked) =>
                        checked
                          ? addRatio(index, ratio)
                          : update(index, {
                              ...tier,
                              ratios: tier.ratios.filter((item) => item.ratio !== ratio),
                            })
                      }
                    />
                    {ratio}
                  </label>
                  {rule.kind === 'provider' ? (
                    <p className="mt-2 text-[10px] text-muted-foreground">由服务商决定</p>
                  ) : cell ? (
                    <Input
                      className="mt-2 h-6 px-1 text-[10px]"
                      aria-label={`${tier.name} ${ratio} 像素`}
                      value={cell.pixels ?? defaultTierPixels(rule, tier.name, ratio) ?? ''}
                      placeholder="WxH"
                      onChange={(event) =>
                        update(index, {
                          ...tier,
                          ratios: tier.ratios.map((item) =>
                            item.ratio === ratio
                              ? { ...item, pixels: event.target.value || undefined, manual: true }
                              : item,
                          ),
                        })
                      }
                    />
                  ) : (
                    <p className="mt-2 text-[10px] text-muted-foreground">
                      {defaultTierPixels(rule, tier.name, ratio) ?? '未配置'}
                    </p>
                  )}
                  {cell?.manual && <span className="text-[10px] text-primary">手动</span>}
                </div>
              );
            })}
          </div>
          <div className="flex gap-2">
            <Input
              aria-label={`${tier.name} 其他比例`}
              placeholder="其他比例，如 17:11"
              value={other[tier.name] ?? ''}
              onChange={(event) => setOther({ ...other, [tier.name]: event.target.value })}
            />
            <Button
              size="sm"
              variant="outline"
              onClick={() => addRatio(index, other[tier.name] ?? '')}
            >
              添加
            </Button>
          </div>
        </article>
      ))}
      <div className="flex gap-2">
        <Input
          aria-label="新档位名称"
          placeholder="档位名称"
          value={newTier}
          onChange={(event) => setTier(event.target.value)}
        />
        <Button
          variant="outline"
          disabled={!newTier.trim() || value.tiers.some((tier) => tier.name === newTier.trim())}
          onClick={() => {
            onChange({
              ...value,
              tiers: [...value.tiers, { name: newTier.trim(), enabled: true, ratios: [] }],
            });
            setTier('');
          }}
        >
          添加档位
        </Button>
      </div>
      <Choices
        path="size.default"
        label="默认档位"
        value={value.default.tier ?? ''}
        values={value.tiers.filter((tier) => tier.enabled).map((tier) => tier.name)}
        onChange={(tier) =>
          onChange({
            ...value,
            default: { ...value.default, tier: tier || undefined, auto: false },
          })
        }
      />
      <Choices
        path="size.default"
        label="默认比例"
        value={value.default.ratio ?? ''}
        values={
          value.tiers
            .find((tier) => tier.name === value.default.tier)
            ?.ratios.map((cell) => cell.ratio) ?? []
        }
        onChange={(ratio) =>
          onChange({
            ...value,
            default: { ...value.default, ratio: ratio || undefined, auto: false },
          })
        }
      />
      <ToggleField
        path="size.default"
        label="默认自动尺寸"
        checked={!!value.default.auto}
        onChange={(auto) => onChange({ ...value, default: { ...value.default, auto } })}
      />
      <ToggleField
        path="size.custom"
        label="允许自定义尺寸"
        checked={!!value.custom}
        onChange={(checked) => onChange({ ...value, custom: checked ? {} : undefined })}
      />
      {value.custom && (
        <div className="grid gap-3 sm:grid-cols-2">
          {(
            ['minEdge', 'maxEdge', 'multipleOf', 'minPixels', 'maxPixels', 'maxAspect'] as const
          ).map((key) => (
            <NumberField
              key={key}
              path={`size.custom.${key}`}
              label={
                {
                  minEdge: '单边最小',
                  maxEdge: '单边最大',
                  multipleOf: '边长倍数',
                  minPixels: '最小像素',
                  maxPixels: '最大像素',
                  maxAspect: '最大宽高比',
                }[key]
              }
              value={value.custom?.[key]}
              onChange={(limit) =>
                onChange({ ...value, custom: { ...value.custom, [key]: limit } })
              }
            />
          ))}
        </div>
      )}
      <Field label="带参考图像素上限">
        <Input
          type="number"
          placeholder="不限"
          value={value.withReference?.maxPixels ?? ''}
          onChange={(event) =>
            onChange({
              ...value,
              withReference: {
                maxPixels: event.target.value === '' ? undefined : Number(event.target.value),
              },
            })
          }
        />
      </Field>
      <ErrorMessage error={error} />
    </div>
  );
}
