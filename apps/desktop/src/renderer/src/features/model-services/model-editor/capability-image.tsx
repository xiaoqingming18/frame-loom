import type { ImageCap, ProtocolDescriptor } from '@frame-loom/contracts';
import { NumberField, ToggleField, TagsField, Choices } from './capability-controls';
import { ImageTierEditor } from './image-tier-editor';

export function CapabilityImage({
  value,
  onChange,
  descriptor,
}: {
  value: ImageCap;
  onChange: (value: ImageCap) => void;
  descriptor: ProtocolDescriptor;
}) {
  const ceiling = descriptor.ceiling.image!;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <NumberField
          path="references.max"
          value={value.references.max}
          onChange={(max) => onChange({ ...value, references: { ...value.references, max } })}
        />
        <NumberField
          path="references.maxBytes"
          label="单张上限 MB"
          scale={1024 * 1024}
          value={value.references.maxBytes}
          onChange={(maxBytes) =>
            onChange({ ...value, references: { ...value.references, maxBytes } })
          }
        />
      </div>
      <TagsField
        path="references.formats"
        values={value.references.formats}
        onChange={(formats) => onChange({ ...value, references: { ...value.references, formats } })}
      />
      {ceiling.mask.length > 0 && (
        <>
          <ToggleField
            path="mask"
            label="蒙版编辑"
            checked={!!value.mask}
            onChange={(checked) =>
              onChange({ ...value, mask: checked ? { semantics: ceiling.mask[0] } : undefined })
            }
          />
          {value.mask && (
            <Choices
              path="mask"
              value={value.mask.semantics}
              values={ceiling.mask}
              onChange={(semantics) =>
                onChange({ ...value, mask: { semantics: semantics as 'alpha' | 'black' } })
              }
            />
          )}
        </>
      )}
      <NumberField
        path="count.max"
        value={value.count.max}
        onChange={(max) => onChange({ ...value, count: { max } })}
      />
      <ImageTierEditor
        value={value.size}
        onChange={(size) => onChange({ ...value, size })}
        descriptor={descriptor}
      />
      {ceiling.quality && (
        <>
          <ToggleField
            path="quality"
            checked={!!value.quality}
            onChange={(checked) =>
              onChange({
                ...value,
                quality: checked
                  ? { values: ['low', 'medium', 'high'], default: 'high' }
                  : undefined,
              })
            }
          />
          {value.quality && (
            <>
              <TagsField
                path="quality"
                label="支持质量"
                values={value.quality.values}
                onChange={(values) =>
                  onChange({ ...value, quality: { ...value.quality!, values } })
                }
              />
              <Choices
                path="quality"
                label="默认质量"
                value={value.quality.default}
                values={value.quality.values}
                onChange={(quality) =>
                  onChange({ ...value, quality: { ...value.quality!, default: quality } })
                }
              />
            </>
          )}
        </>
      )}
      {ceiling.transparentBackground && (
        <>
          <ToggleField
            path="background"
            label="支持透明背景"
            checked={!!value.background?.transparent}
            onChange={(transparent) =>
              onChange({
                ...value,
                background: { default: value.background?.default ?? 'auto', transparent },
              })
            }
          />
          <Choices
            path="background"
            label="默认背景"
            value={value.background?.default ?? 'auto'}
            values={['auto', 'opaque', ...(value.background?.transparent ? ['transparent'] : [])]}
            onChange={(background) =>
              onChange({
                ...value,
                background: {
                  transparent: value.background?.transparent ?? false,
                  default: background as 'auto' | 'opaque' | 'transparent',
                },
              })
            }
          />
        </>
      )}
      <Choices
        path="responseFormat"
        value={value.responseFormat ?? ''}
        values={ceiling.responseFormats}
        onChange={(format) =>
          onChange({
            ...value,
            responseFormat: (format || undefined) as ImageCap['responseFormat'],
          })
        }
      />
      <TagsField
        path="outputFormats"
        values={value.outputFormats}
        onChange={(outputFormats) => onChange({ ...value, outputFormats })}
      />
      {ceiling.compression && (
        <>
          <ToggleField
            path="compression"
            checked={!!value.compression}
            onChange={(checked) =>
              onChange({ ...value, compression: checked ? { min: 0, max: 100 } : undefined })
            }
          />
          {value.compression && (
            <div className="grid grid-cols-2 gap-2">
              <NumberField
                path="compression"
                label="压缩率最小"
                value={value.compression.min}
                onChange={(min) =>
                  onChange({ ...value, compression: { ...value.compression!, min: min ?? 0 } })
                }
              />
              <NumberField
                path="compression"
                label="压缩率最大"
                value={value.compression.max}
                onChange={(max) =>
                  onChange({ ...value, compression: { ...value.compression!, max: max ?? 100 } })
                }
              />
            </div>
          )}
        </>
      )}
      {ceiling.seed && (
        <ToggleField
          path="seed"
          checked={value.seed}
          onChange={(seed) => onChange({ ...value, seed })}
        />
      )}
      {ceiling.negativePrompt && (
        <ToggleField
          path="negativePrompt"
          checked={value.negativePrompt}
          onChange={(negativePrompt) => onChange({ ...value, negativePrompt })}
        />
      )}
      <NumberField
        path="promptMaxChars"
        value={value.promptMaxChars}
        onChange={(promptMaxChars) => onChange({ ...value, promptMaxChars })}
      />
    </div>
  );
}
