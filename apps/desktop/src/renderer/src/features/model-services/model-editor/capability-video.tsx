import {
  VIDEO_MODE_LABELS,
  type VideoCap,
  type ProtocolDescriptor,
  type VideoModeId,
} from '@frame-loom/contracts';
import { NativeSelect } from '@frame-loom/ui/components/native-select';
import { Input } from '@frame-loom/ui/components/input';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@frame-loom/ui/components/table';
import { Field } from '../form-fields';
import { Choices, NumberField, TagsField, ToggleField } from './capability-controls';

const modeMaterials: Record<VideoModeId, string> = {
  t2v: '无素材',
  first: '首帧 1 张',
  last: '尾帧 1 张',
  first_last: '首帧 1 张 + 尾帧 1 张',
  keyframes: '关键帧若干',
  reference: '参考素材',
  edit: '待编辑视频 1 个',
  extend: '待编辑视频 1 个',
};
export function CapabilityVideo({
  value,
  onChange,
  descriptor,
}: {
  value: VideoCap;
  onChange: (value: VideoCap) => void;
  descriptor: ProtocolDescriptor;
}) {
  const ceiling = descriptor.ceiling.video!;
  const setMode = (index: number, mode: VideoCap['modes'][number]) =>
    onChange({ ...value, modes: value.modes.map((item, i) => (i === index ? mode : item)) });
  return (
    <div className="space-y-4">
      <h3 className="text-sm font-medium">生成方式</h3>
      {ceiling.modes.map((id) => {
        const mode = value.modes.find((mode) => mode.id === id);
        const index = value.modes.findIndex((mode) => mode.id === id);
        return (
          <div key={id} className="rounded-lg border border-border p-3">
            <ToggleField
              path="modes"
              label={VIDEO_MODE_LABELS[id]}
              checked={!!mode}
              onChange={(checked) =>
                onChange({
                  ...value,
                  modes: checked
                    ? [
                        ...value.modes,
                        {
                          id,
                          ...(id === 'reference'
                            ? {
                                reference: {
                                  accept: [...ceiling.referenceKinds],
                                  withFrames: false,
                                },
                              }
                            : {}),
                        },
                      ]
                    : value.modes.filter((item) => item.id !== id),
                })
              }
            />
            {mode && (
              <details className="mt-2">
                <summary className="cursor-pointer text-xs text-muted-foreground">
                  {modeMaterials[id]} · 素材设置
                </summary>
                <div className="mt-3 space-y-3">
                  {id === 'keyframes' && (
                    <div className="grid grid-cols-2 gap-2">
                      <NumberField
                        path="modes"
                        label="关键帧最少"
                        value={mode.keyframes?.min}
                        onChange={(min) =>
                          setMode(index, { ...mode, keyframes: { ...mode.keyframes, min } })
                        }
                      />
                      <NumberField
                        path="modes"
                        label="关键帧最多"
                        value={mode.keyframes?.max}
                        onChange={(max) =>
                          setMode(index, { ...mode, keyframes: { ...mode.keyframes, max } })
                        }
                      />
                    </div>
                  )}
                  {id === 'reference' ? (
                    <>
                      {ceiling.referenceKinds.map((kind) => (
                        <ToggleField
                          key={kind}
                          path="modes"
                          label={`接受参考${{ image: '图', video: '视频', audio: '音频' }[kind]}`}
                          checked={mode.reference?.accept.includes(kind) ?? false}
                          onChange={(checked) =>
                            setMode(index, {
                              ...mode,
                              reference: {
                                withFrames: mode.reference?.withFrames ?? false,
                                accept: checked
                                  ? [...(mode.reference?.accept ?? []), kind]
                                  : (mode.reference?.accept ?? []).filter((item) => item !== kind),
                              },
                            })
                          }
                        />
                      ))}
                      {ceiling.mixFramesWithReference && (
                        <ToggleField
                          path="modes"
                          label="可同时带首尾帧"
                          checked={mode.reference?.withFrames ?? false}
                          onChange={(withFrames) =>
                            setMode(index, {
                              ...mode,
                              reference: { accept: mode.reference?.accept ?? [], withFrames },
                            })
                          }
                        />
                      )}
                    </>
                  ) : (
                    id !== 't2v' &&
                    ceiling.mixFramesWithReference && (
                      <ToggleField
                        path="modes"
                        label="可同时带参考素材"
                        checked={mode.withReference ?? false}
                        onChange={(withReference) => setMode(index, { ...mode, withReference })}
                      />
                    )
                  )}
                </div>
              </details>
            )}
          </div>
        );
      })}
      <Choices
        path="defaultMode"
        value={value.defaultMode}
        values={value.modes.map((mode) => mode.id)}
        onChange={(mode) => onChange({ ...value, defaultMode: mode as VideoModeId })}
      />
      {descriptor.rules.map((rule, index) => (
        <p key={index} className="rounded-lg bg-muted/60 p-3 text-xs text-muted-foreground">
          协议规则：{rule.message}
        </p>
      ))}
      <h3 className="text-sm font-medium">参考素材限制</h3>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>素材</TableHead>
            <TableHead>最多数量</TableHead>
            <TableHead>单个 MB</TableHead>
            <TableHead>最短秒</TableHead>
            <TableHead>最长秒</TableHead>
            <TableHead>总时长秒</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {(['image', 'video', 'audio'] as const)
            .filter((kind) => ceiling.referenceKinds.includes(kind) || kind === 'image')
            .map((kind) => (
              <TableRow key={kind}>
                <TableCell>
                  {{ image: '参考图', video: '参考视频', audio: '参考音频' }[kind]}
                </TableCell>
                {(
                  ['max', 'maxBytes', 'minDurationSec', 'maxDurationSec', 'maxTotalSec'] as const
                ).map((key) => (
                  <TableCell key={key}>
                    {kind === 'image' && key.includes('Sec') ? (
                      '—'
                    ) : (
                      <Input
                        className="min-w-16"
                        type="number"
                        min={0}
                        step="any"
                        aria-label={`${kind} ${key}`}
                        placeholder="不限"
                        value={
                          value.references[kind]?.[key] === undefined
                            ? ''
                            : value.references[kind][key] / (key === 'maxBytes' ? 1024 * 1024 : 1)
                        }
                        onChange={(event) =>
                          onChange({
                            ...value,
                            references: {
                              ...value.references,
                              [kind]: {
                                ...value.references[kind],
                                [key]:
                                  event.target.value === ''
                                    ? undefined
                                    : Number(event.target.value) *
                                      (key === 'maxBytes' ? 1024 * 1024 : 1),
                              },
                            },
                          })
                        }
                      />
                    )}
                  </TableCell>
                ))}
              </TableRow>
            ))}
        </TableBody>
      </Table>
      <NumberField
        path="references.totalCount"
        value={value.references.totalCount}
        onChange={(totalCount) =>
          onChange({ ...value, references: { ...value.references, totalCount } })
        }
      />
      <Field label="输出时长模式">
        <NativeSelect
          value={value.duration.kind}
          onChange={(event) =>
            onChange({
              ...value,
              duration:
                event.target.value === 'range'
                  ? { kind: 'range', min: 4, max: 10, step: 1, default: 5 }
                  : event.target.value === 'values'
                    ? { kind: 'values', values: [5], default: 5 }
                    : { kind: 'auto' },
            })
          }
        >
          <option value="range">范围</option>
          <option value="values">固定值</option>
          {ceiling.durationAuto && <option value="auto">交给模型</option>}
        </NativeSelect>
      </Field>
      {value.duration.kind === 'range' && (
        <div className="grid grid-cols-2 gap-3">
          {(['min', 'max', 'step', 'default'] as const).map((key) => (
            <Field
              key={key}
              label={`时长 ${{ min: '最短', max: '最长', step: '步长', default: '默认' }[key]}`}
            >
              <Input
                type="number"
                value={value.duration.kind === 'range' ? value.duration[key] : ''}
                onChange={(event) => {
                  if (value.duration.kind === 'range')
                    onChange({
                      ...value,
                      duration: { ...value.duration, [key]: Number(event.target.value) },
                    });
                }}
              />
            </Field>
          ))}
        </div>
      )}
      {value.duration.kind === 'values' && (
        <>
          <TagsField
            path="duration"
            label="固定时长（秒）"
            values={value.duration.values.map(String)}
            onChange={(values) => {
              if (value.duration.kind === 'values')
                onChange({ ...value, duration: { ...value.duration, values: values.map(Number) } });
            }}
          />
          <Choices
            path="duration"
            label="默认时长"
            value={String(value.duration.default)}
            values={value.duration.values.map(String)}
            onChange={(duration) => {
              if (value.duration.kind === 'values')
                onChange({ ...value, duration: { ...value.duration, default: Number(duration) } });
            }}
          />
        </>
      )}
      {ceiling.durationAuto && value.duration.kind !== 'auto' && (
        <ToggleField
          path="duration"
          label="同时允许交给模型"
          checked={value.duration.allowAuto ?? false}
          onChange={(allowAuto) => {
            if (value.duration.kind !== 'auto')
              onChange({ ...value, duration: { ...value.duration, allowAuto } });
          }}
        />
      )}
      <TagsField
        path="aspectRatios"
        values={value.aspectRatios}
        onChange={(aspectRatios) => onChange({ ...value, aspectRatios })}
      />
      <Choices
        path="defaultAspectRatio"
        value={value.defaultAspectRatio ?? ''}
        values={value.aspectRatios}
        onChange={(defaultAspectRatio) =>
          onChange({ ...value, defaultAspectRatio: defaultAspectRatio || undefined })
        }
      />
      <TagsField
        path="resolutions"
        values={value.resolutions}
        onChange={(resolutions) => onChange({ ...value, resolutions })}
      />
      <Choices
        path="defaultResolution"
        value={value.defaultResolution ?? ''}
        values={value.resolutions}
        onChange={(defaultResolution) =>
          onChange({ ...value, defaultResolution: defaultResolution || undefined })
        }
      />
      <Choices
        path="audio"
        value={value.audio.mode}
        values={
          ceiling.audioControl ? ['on', 'off', 'optional', 'unknown'] : ['on', 'off', 'unknown']
        }
        onChange={(mode) =>
          onChange({ ...value, audio: { mode: mode as VideoCap['audio']['mode'] } })
        }
      />
      {value.audio.mode === 'optional' && (
        <ToggleField
          path="audio"
          label="默认有声"
          checked={value.audio.default ?? false}
          onChange={(enabled) =>
            onChange({ ...value, audio: { ...value.audio, default: enabled } })
          }
        />
      )}
      {ceiling.watermark && (
        <>
          <ToggleField
            path="watermark"
            label="支持水印开关"
            checked={!!value.watermark}
            onChange={(checked) =>
              onChange({ ...value, watermark: checked ? { default: false } : undefined })
            }
          />
          {value.watermark && (
            <ToggleField
              path="watermark"
              label="默认水印"
              checked={value.watermark.default}
              onChange={(enabled) => onChange({ ...value, watermark: { default: enabled } })}
            />
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
      <NumberField
        path="promptMaxChars"
        value={value.promptMaxChars}
        onChange={(promptMaxChars) => onChange({ ...value, promptMaxChars })}
      />
      <Choices
        path="promptRef"
        value={value.promptRef.syntax}
        values={ceiling.promptRefs}
        onChange={(syntax) =>
          onChange({
            ...value,
            promptRef: { ...value.promptRef, syntax: syntax as VideoCap['promptRef']['syntax'] },
          })
        }
      />
      <Choices
        path="promptRef"
        label="起始编号"
        value={String(value.promptRef.base)}
        values={['0', '1']}
        onChange={(base) =>
          onChange({ ...value, promptRef: { ...value.promptRef, base: Number(base) as 0 | 1 } })
        }
      />
    </div>
  );
}
