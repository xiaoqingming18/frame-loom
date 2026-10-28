import {
  SAMPLING_PARAM_LABELS,
  type ChatCap,
  type ProtocolDescriptor,
} from '@frame-loom/contracts';
import { NumberField, ToggleField, TagsField } from './capability-controls';

export function CapabilityChat({
  value,
  onChange,
  descriptor,
}: {
  value: ChatCap;
  onChange: (value: ChatCap) => void;
  descriptor: ProtocolDescriptor;
}) {
  const ceiling = descriptor.ceiling.chat!;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <NumberField
          path="contextWindow"
          value={value.contextWindow}
          onChange={(contextWindow) => onChange({ ...value, contextWindow })}
        />
        <NumberField
          path="maxOutput"
          value={value.maxOutput}
          onChange={(maxOutput) => onChange({ ...value, maxOutput })}
        />
      </div>
      <p className="text-xs text-muted-foreground">输入模态</p>
      {ceiling.inputModalities.map((modality) => (
        <ToggleField
          key={modality}
          path="inputModalities"
          label={modality}
          checked={value.inputModalities.includes(modality)}
          onChange={(checked) =>
            onChange({
              ...value,
              inputModalities: checked
                ? [...value.inputModalities, modality]
                : value.inputModalities.filter((item) => item !== modality),
            })
          }
        />
      ))}
      {ceiling.tools && (
        <ToggleField
          path="tools"
          checked={value.tools}
          onChange={(tools) => onChange({ ...value, tools })}
        />
      )}
      <ToggleField
        path="streaming"
        checked={value.streaming}
        onChange={(streaming) => onChange({ ...value, streaming })}
      />
      {ceiling.reasoning && (
        <TagsField
          path="reasoningLevels"
          values={value.reasoningLevels}
          onChange={(reasoningLevels) => onChange({ ...value, reasoningLevels })}
        />
      )}
      <p className="text-xs text-muted-foreground">允许发送的采样参数；默认全部不发送</p>
      {ceiling.samplingParams.map((param) => (
        <ToggleField
          key={param}
          path="samplingParams"
          label={SAMPLING_PARAM_LABELS[param]}
          checked={value.samplingParams.includes(param)}
          onChange={(checked) =>
            onChange({
              ...value,
              samplingParams: checked
                ? [...value.samplingParams, param]
                : value.samplingParams.filter((item) => item !== param),
            })
          }
        />
      ))}
    </div>
  );
}
