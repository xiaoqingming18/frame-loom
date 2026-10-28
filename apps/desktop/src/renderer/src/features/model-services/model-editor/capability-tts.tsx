import type { TtsCap, ProtocolDescriptor } from '@frame-loom/contracts';
import { Button } from '@frame-loom/ui/components/button';
import { Input } from '@frame-loom/ui/components/input';
import { Field } from '../form-fields';
import { NumberField, ToggleField, RangeField, TagsField, Choices } from './capability-controls';

export function CapabilityTts({
  value,
  onChange,
  descriptor,
}: {
  value: TtsCap;
  onChange: (value: TtsCap) => void;
  descriptor: ProtocolDescriptor;
}) {
  const ceiling = descriptor.ceiling.tts!;
  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">音色来源</p>
      {ceiling.voiceSources.map((source) => (
        <ToggleField
          key={source}
          path="voices"
          label={{ preset: '预置音色', remote: '远端目录', manual: '手填 ID' }[source]}
          checked={value.voices.sources.includes(source)}
          onChange={(checked) =>
            onChange({
              ...value,
              voices: {
                ...value.voices,
                sources: checked
                  ? [...value.voices.sources, source]
                  : value.voices.sources.filter((item) => item !== source),
              },
            })
          }
        />
      ))}
      {value.voices.sources.includes('preset') && (
        <div className="space-y-2">
          {value.voices.presets.map((voice, index) => (
            <div key={index} className="flex gap-2">
              <Input
                aria-label={`音色 ID ${index + 1}`}
                value={voice.id}
                onChange={(event) =>
                  onChange({
                    ...value,
                    voices: {
                      ...value.voices,
                      presets: value.voices.presets.map((item, i) =>
                        i === index ? { ...item, id: event.target.value } : item,
                      ),
                    },
                  })
                }
              />
              <Input
                aria-label={`音色名称 ${index + 1}`}
                value={voice.name}
                onChange={(event) =>
                  onChange({
                    ...value,
                    voices: {
                      ...value.voices,
                      presets: value.voices.presets.map((item, i) =>
                        i === index ? { ...item, name: event.target.value } : item,
                      ),
                    },
                  })
                }
              />
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  onChange({
                    ...value,
                    voices: {
                      ...value.voices,
                      presets: value.voices.presets.filter((_, i) => i !== index),
                    },
                  })
                }
              >
                移除
              </Button>
            </div>
          ))}
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              onChange({
                ...value,
                voices: {
                  ...value.voices,
                  presets: [...value.voices.presets, { id: '', name: '' }],
                },
              })
            }
          >
            添加预置音色
          </Button>
        </div>
      )}
      <Field label="默认音色">
        <Input
          value={value.voices.default ?? ''}
          onChange={(event) =>
            onChange({
              ...value,
              voices: { ...value.voices, default: event.target.value || undefined },
            })
          }
        />
      </Field>
      {ceiling.instructions && (
        <ToggleField
          path="instructions"
          checked={value.instructions}
          onChange={(instructions) => onChange({ ...value, instructions })}
        />
      )}
      {(['speed', 'pitch', 'volume'] as const)
        .filter((key) => ceiling[key])
        .map((key) => (
          <RangeField
            key={key}
            path={key}
            value={value[key]}
            onChange={(range) => onChange({ ...value, [key]: range })}
          />
        ))}
      <TagsField
        path="formats"
        values={value.formats}
        onChange={(formats) => onChange({ ...value, formats })}
      />
      <Choices
        path="defaultFormat"
        value={value.defaultFormat ?? ''}
        values={value.formats}
        onChange={(defaultFormat) =>
          onChange({ ...value, defaultFormat: defaultFormat || undefined })
        }
      />
      <TagsField
        path="sampleRates"
        values={value.sampleRates.map(String)}
        onChange={(rates) => onChange({ ...value, sampleRates: rates.map(Number) })}
      />
      <Choices
        path="defaultSampleRate"
        value={value.defaultSampleRate?.toString() ?? ''}
        values={value.sampleRates.map(String)}
        onChange={(rate) =>
          onChange({ ...value, defaultSampleRate: rate ? Number(rate) : undefined })
        }
      />
      <NumberField
        path="maxChars"
        value={value.maxChars}
        onChange={(maxChars) => onChange({ ...value, maxChars })}
      />
      {ceiling.multiSpeaker && (
        <NumberField
          path="multiSpeaker"
          value={value.multiSpeaker?.max}
          onChange={(max) =>
            onChange({ ...value, multiSpeaker: max === undefined ? undefined : { max } })
          }
        />
      )}
    </div>
  );
}
