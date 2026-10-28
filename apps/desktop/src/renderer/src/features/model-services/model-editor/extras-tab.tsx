import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { ExtraParam, type ModelWrite } from '@frame-loom/contracts';
import { Input } from '@frame-loom/ui/components/input';
import { Button } from '@frame-loom/ui/components/button';
import { Textarea } from '@frame-loom/ui/components/textarea';
import { NativeSelect } from '@frame-loom/ui/components/native-select';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@frame-loom/ui/components/table';
import type { EngineClient } from '@/lib/engine-client';
import { ErrorMessage, Field } from '../form-fields';
import { TagsField } from './capability-controls';

function JsonValue({
  value,
  onChange,
  onError,
  label,
}: {
  value: unknown;
  onChange: (value: z.infer<ReturnType<typeof z.json>>) => void;
  onError: (error: string) => void;
  label: string;
}) {
  const [source, setSource] = useState(JSON.stringify(value));
  return (
    <Textarea
      aria-label={label}
      className="min-w-32 font-mono text-xs"
      value={source}
      onChange={(event) => {
        setSource(event.target.value);
        try {
          const parsed = z.json().parse(JSON.parse(event.target.value));
          onChange(parsed);
          onError('');
        } catch {
          onError(`${label} 不是有效 JSON`);
        }
      }}
    />
  );
}
export function ExtrasTab({
  client,
  modelId,
  draft,
  onChange,
  onInvalid,
}: {
  client: EngineClient;
  modelId?: string;
  draft: ModelWrite;
  onChange: (value: ModelWrite) => void;
  onInvalid: (invalid: boolean) => void;
}) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [fixedKeys, setFixedKeys] = useState(() =>
    draft.fixedFields.map(() => crypto.randomUUID()),
  );
  const [previewing, setPreviewing] = useState(false);
  const preview = useQuery({
    queryKey: ['models', 'preview', modelId],
    enabled: !!modelId && previewing,
    queryFn: () =>
      client.request(
        `/models/${modelId}/preview-request`,
        z.object({ body: z.unknown(), method: z.string(), url: z.string() }),
        { method: 'POST' },
      ),
  });
  const error = (key: string, message: string) => {
    const next = { ...errors, [key]: message };
    setErrors(next);
    onInvalid(Object.values(next).some(Boolean));
  };
  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <h3 className="text-sm font-medium">附加参数</h3>
        <Table>
          <TableHeader>
            <TableRow>
              {['参数键', '名称', '类型', '可选值', '默认值', '上游字段路径', '操作'].map(
                (label) => (
                  <TableHead key={label}>{label}</TableHead>
                ),
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {draft.extras.map((extra, index) => {
              const update = (patch: Partial<ExtraParam>) =>
                onChange({
                  ...draft,
                  extras: draft.extras.map((item, i) =>
                    i === index ? { ...item, ...patch } : item,
                  ),
                });
              return (
                <TableRow key={index}>
                  <TableCell>
                    <Input
                      aria-label={`参数键 ${index + 1}`}
                      value={extra.key}
                      onChange={(event) => update({ key: event.target.value })}
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      aria-label={`参数名称 ${index + 1}`}
                      value={extra.label}
                      onChange={(event) => update({ label: event.target.value })}
                    />
                  </TableCell>
                  <TableCell>
                    <NativeSelect
                      aria-label={`参数类型 ${index + 1}`}
                      value={extra.type}
                      onChange={(event) => {
                        error(`extra${index}`, '');
                        update({
                          type: event.target.value as ExtraParam['type'],
                          default: undefined,
                          values: undefined,
                        });
                      }}
                    >
                      {ExtraParam.shape.type.options.map((type) => (
                        <option key={type} value={type}>
                          {type}
                        </option>
                      ))}
                    </NativeSelect>
                  </TableCell>
                  <TableCell>
                    {extra.type === 'enum' ? (
                      <TagsField
                        path="extras.values"
                        label={`枚举值 ${index + 1}`}
                        values={extra.values?.map(String) ?? []}
                        onChange={(values) => update({ values })}
                      />
                    ) : (
                      '—'
                    )}
                  </TableCell>
                  <TableCell>
                    {extra.type === 'boolean' ? (
                      <NativeSelect
                        aria-label={`参数默认值 ${index + 1}`}
                        value={extra.default === undefined ? '' : String(extra.default)}
                        onChange={(event) =>
                          update({
                            default:
                              event.target.value === '' ? undefined : event.target.value === 'true',
                          })
                        }
                      >
                        <option value="">未设置</option>
                        <option value="true">true</option>
                        <option value="false">false</option>
                      </NativeSelect>
                    ) : (
                      <Input
                        aria-label={`参数默认值 ${index + 1}`}
                        value={String(extra.default ?? '')}
                        onChange={(event) => {
                          const text = event.target.value;
                          const value =
                            text === '' ? undefined : extra.type === 'number' ? Number(text) : text;
                          error(
                            `extra${index}`,
                            typeof value === 'number' && !Number.isFinite(value)
                              ? '默认值必须为有效数字'
                              : '',
                          );
                          update({ default: value });
                        }}
                      />
                    )}
                  </TableCell>
                  <TableCell>
                    <Input
                      aria-label={`上游字段路径 ${index + 1}`}
                      value={extra.path}
                      onChange={(event) => update({ path: event.target.value })}
                    />
                  </TableCell>
                  <TableCell>
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => {
                        error(`extra${index}`, '');
                        onChange({ ...draft, extras: draft.extras.filter((_, i) => i !== index) });
                      }}
                    >
                      删除
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        <Button
          size="sm"
          variant="outline"
          disabled={draft.extras.length >= 30}
          onClick={() =>
            onChange({
              ...draft,
              extras: [
                ...draft.extras,
                { key: `param${draft.extras.length + 1}`, label: '参数', type: 'string', path: '' },
              ],
            })
          }
        >
          添加参数
        </Button>
      </section>
      <section className="space-y-3">
        <h3 className="text-sm font-medium">固定请求字段</h3>
        {draft.fixedFields.map((field, index) => (
          <div
            key={fixedKeys[index]}
            className="grid items-start gap-2 sm:grid-cols-[1fr_1fr_auto]"
          >
            <Field label={`固定字段路径 ${index + 1}`}>
              <Input
                value={field.path}
                onChange={(event) =>
                  onChange({
                    ...draft,
                    fixedFields: draft.fixedFields.map((item, i) =>
                      i === index ? { ...item, path: event.target.value } : item,
                    ),
                  })
                }
              />
            </Field>
            <JsonValue
              label={`JSON 值 ${index + 1}`}
              value={field.value}
              onError={(message) => error(`fixed${index}`, message)}
              onChange={(value) =>
                onChange({
                  ...draft,
                  fixedFields: draft.fixedFields.map((item, i) =>
                    i === index ? { ...item, value } : item,
                  ),
                })
              }
            />
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                const nextErrors = Object.fromEntries(
                  Object.entries(errors).filter(([key]) => !key.startsWith('fixed')),
                );
                draft.fixedFields.forEach((_, i) => {
                  if (i !== index && errors[`fixed${i}`])
                    nextErrors[`fixed${i > index ? i - 1 : i}`] = errors[`fixed${i}`];
                });
                setErrors(nextErrors);
                onInvalid(Object.values(nextErrors).some(Boolean));
                setFixedKeys(fixedKeys.filter((_, i) => i !== index));
                onChange({
                  ...draft,
                  fixedFields: draft.fixedFields.filter((_, i) => i !== index),
                });
              }}
            >
              删除
            </Button>
          </div>
        ))}
        <Button
          size="sm"
          variant="outline"
          disabled={draft.fixedFields.length >= 30}
          onClick={() => {
            setFixedKeys([...fixedKeys, crypto.randomUUID()]);
            onChange({ ...draft, fixedFields: [...draft.fixedFields, { path: '', value: '' }] });
          }}
        >
          添加固定字段
        </Button>
      </section>
      {Object.entries(errors).map(([key, value]) => (
        <ErrorMessage key={key} error={value} />
      ))}
      <section className="space-y-3">
        <h3 className="text-sm font-medium">请求体预览</h3>
        {modelId ? (
          <Button size="sm" variant="outline" onClick={() => setPreviewing(true)}>
            预览已保存的请求
          </Button>
        ) : (
          <p className="text-xs text-muted-foreground">保存后可预览</p>
        )}
        <ErrorMessage error={preview.error} />
        {preview.data && (
          <>
            <pre className="max-h-80 overflow-auto rounded-lg bg-muted p-3 text-xs">
              {JSON.stringify(preview.data, null, 2)}
            </pre>
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                void navigator.clipboard.writeText(JSON.stringify(preview.data, null, 2))
              }
            >
              复制
            </Button>
          </>
        )}
      </section>
    </div>
  );
}
