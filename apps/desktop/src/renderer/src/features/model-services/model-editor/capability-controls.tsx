import { useContext, useState, type ReactNode } from 'react';
import { CAPABILITY_FIELDS, type Range } from '@frame-loom/contracts';
import { Input } from '@frame-loom/ui/components/input';
import { Checkbox } from '@frame-loom/ui/components/checkbox';
import { NativeSelect } from '@frame-loom/ui/components/native-select';
import { Field } from '../form-fields';
import { CapabilityComparison } from './capability-comparison';
function useModified(path: string) {
  const comparison = useContext(CapabilityComparison);
  const read = (value: unknown) =>
    path
      .split('.')
      .reduce<unknown>(
        (part, key) =>
          part && typeof part === 'object' ? (part as Record<string, unknown>)[key] : undefined,
        value,
      );
  return (
    !!comparison &&
    JSON.stringify(read(comparison.current)) !== JSON.stringify(read(comparison.template))
  );
}

export function CapField({
  path,
  children,
  label,
}: {
  path: string;
  children: ReactNode;
  label?: string;
}) {
  const metadata = CAPABILITY_FIELDS.find((field) => field.path === path);
  const modified = useModified(path);
  return (
    <div
      data-modified={modified}
      className={`border-l-2 pl-2 ${modified ? 'border-primary' : 'border-transparent'}`}
    >
      <Field label={label ?? metadata?.label ?? path} help={metadata?.help}>
        {children}
      </Field>
    </div>
  );
}
export function NumberField({
  path,
  value,
  onChange,
  label,
  scale = 1,
}: {
  path: string;
  value: number | undefined;
  onChange: (value: number | undefined) => void;
  label?: string;
  scale?: number;
}) {
  return (
    <CapField path={path} label={label}>
      <Input
        type="number"
        min={0}
        step="any"
        placeholder="不限"
        value={value === undefined ? '' : value / scale}
        onChange={(event) =>
          onChange(event.target.value === '' ? undefined : Number(event.target.value) * scale)
        }
      />
    </CapField>
  );
}
export function TagsField({
  path,
  values,
  onChange,
  label,
}: {
  path: string;
  values: string[];
  onChange: (values: string[]) => void;
  label?: string;
}) {
  const [input, setInput] = useState<string>();
  return (
    <CapField path={path} label={label}>
      <Input
        aria-label={label ?? CAPABILITY_FIELDS.find((field) => field.path === path)?.label ?? path}
        value={input ?? values.join(', ')}
        placeholder="用逗号分隔"
        onBlur={() => setInput(undefined)}
        onChange={(event) => {
          setInput(event.target.value);
          onChange(
            event.target.value
              .split(/[,，]/)
              .map((value) => value.trim())
              .filter(Boolean),
          );
        }}
      />
    </CapField>
  );
}
export function ToggleField({
  path,
  checked,
  onChange,
  label,
}: {
  path: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
}) {
  const modified = useModified(path);
  return (
    <label
      data-modified={modified}
      className={`flex items-center gap-2 border-l-2 pl-2 text-sm ${modified ? 'border-primary' : 'border-transparent'}`}
    >
      <Checkbox checked={checked} onCheckedChange={(value) => onChange(value === true)} />
      {label ?? CAPABILITY_FIELDS.find((field) => field.path === path)?.label ?? path}
    </label>
  );
}
export function Choices({
  path,
  value,
  values,
  onChange,
  label,
}: {
  path: string;
  value: string;
  values: string[];
  onChange: (value: string) => void;
  label?: string;
}) {
  return (
    <CapField path={path} label={label}>
      <NativeSelect value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">未设置</option>
        {values.map((item) => (
          <option key={item} value={item}>
            {item}
          </option>
        ))}
      </NativeSelect>
    </CapField>
  );
}
export function RangeField({
  path,
  value,
  onChange,
}: {
  path: string;
  value: Range | undefined;
  onChange: (value: Range | undefined) => void;
}) {
  return (
    <div className="space-y-3">
      <ToggleField
        path={path}
        checked={!!value}
        onChange={(checked) => onChange(checked ? { min: 0.5, max: 2, default: 1 } : undefined)}
      />
      {value && (
        <div className="grid grid-cols-3 gap-2">
          {(['min', 'max', 'default'] as const).map((key) => (
            <Field
              key={key}
              label={`${CAPABILITY_FIELDS.find((field) => field.path === path)?.label} ${{ min: '最小', max: '最大', default: '默认' }[key]}`}
            >
              <Input
                type="number"
                step="any"
                value={value[key]}
                onChange={(event) => onChange({ ...value, [key]: Number(event.target.value) })}
              />
            </Field>
          ))}
        </div>
      )}
    </div>
  );
}
