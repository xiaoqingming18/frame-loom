import type { ExtraParam, Value } from '@frame-loom/contracts';
import { Input } from '@frame-loom/ui/components/input';
import { NativeSelect } from '@frame-loom/ui/components/native-select';

export function ExtraParams({
  definitions,
  values,
  onChange,
  disabled,
}: {
  definitions: ExtraParam[];
  values: Record<string, Value>;
  onChange: (values: Record<string, Value>) => void;
  disabled: boolean;
}) {
  if (!definitions.length) return null;
  return (
    <details className="mt-4 border-t pt-3 text-xs">
      <summary className="cursor-pointer text-muted-foreground">更多参数</summary>
      <div className="mt-3 space-y-3">
        {definitions.map((param) => {
          const value = values[param.key] ?? param.default;
          const set = (value: Value | undefined) => {
            const next = { ...values };
            if (value === undefined) delete next[param.key];
            else next[param.key] = value;
            onChange(next);
          };
          return (
            <label key={param.key} className="flex items-center justify-between gap-3">
              {param.label}
              {param.type === 'enum' ? (
                <NativeSelect
                  aria-label={param.label}
                  disabled={disabled}
                  value={value === undefined ? '' : String(value)}
                  onChange={(event) =>
                    set(param.values?.find((value) => String(value) === event.target.value))
                  }
                  className="max-w-48"
                >
                  <option value="">默认</option>
                  {param.values?.map((value) => (
                    <option key={String(value)} value={String(value)}>
                      {String(value)}
                    </option>
                  ))}
                </NativeSelect>
              ) : param.type === 'boolean' ? (
                <input
                  type="checkbox"
                  aria-label={param.label}
                  disabled={disabled}
                  checked={value === true}
                  onChange={(event) => set(event.target.checked)}
                />
              ) : (
                <Input
                  aria-label={param.label}
                  disabled={disabled}
                  type={param.type === 'number' ? 'number' : 'text'}
                  value={value === undefined ? '' : String(value)}
                  onChange={(event) =>
                    set(
                      !event.target.value
                        ? undefined
                        : param.type === 'number'
                          ? Number(event.target.value)
                          : event.target.value,
                    )
                  }
                  className="max-w-48"
                />
              )}
            </label>
          );
        })}
      </div>
    </details>
  );
}
