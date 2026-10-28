import { useState } from 'react';
import { getProtocol, resolveEndpoints } from '@frame-loom/contracts';
import type { Channel, ModelWrite, Operation } from '@frame-loom/contracts';
import { Input } from '@frame-loom/ui/components/input';
import { Checkbox } from '@frame-loom/ui/components/checkbox';
import { Field } from '../form-fields';

const operationLabels: Record<Operation, string> = {
  submit: '提交',
  edit: '编辑',
  query: '查询',
  content: '下载',
  voices: '音色目录',
};
export function EndpointSection({
  channel,
  draft,
  onChange,
}: {
  channel: Channel;
  draft: ModelWrite;
  onChange: (value: ModelWrite) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const descriptor = draft.protocolId ? getProtocol(draft.protocolId) : undefined;
  if (!descriptor) return null;
  let endpoints: ReturnType<typeof resolveEndpoints>;
  try {
    endpoints = resolveEndpoints(channel, draft, descriptor);
  } catch {
    endpoints = { operations: {}, issues: ['地址草稿无效，请检查覆盖地址。'], foreignHosts: [] };
  }
  const override = draft.endpointOverride;
  return (
    <section className="space-y-3" aria-label="请求地址">
      <h3 className="text-sm font-medium">请求地址</h3>
      <div className="space-y-2 rounded-lg bg-muted/50 p-3">
        {Object.entries(endpoints.operations).map(([operation, spec]) => (
          <p key={operation} className="font-mono text-xs break-all">
            <span className="mr-2 font-sans text-muted-foreground">
              {operationLabels[operation as Operation]}
            </span>
            {spec.method}{' '}
            {spec.url.split(/(\{[^}]+\})/).map((part, index) =>
              part.startsWith('{') ? (
                <strong key={index} className="text-primary">
                  {part}
                </strong>
              ) : (
                part
              ),
            )}
          </p>
        ))}
      </div>
      <Field label="使用完整地址覆盖（可选）">
        <Input
          value={override.submitUrl ?? ''}
          placeholder="留空使用服务地址与协议路径"
          onChange={(event) =>
            onChange({
              ...draft,
              endpointOverride: {
                ...override,
                submitUrl: event.target.value || undefined,
                operations: undefined,
                confirmedHosts: [],
              },
            })
          }
        />
      </Field>
      {override.submitUrl && !endpoints.issues.length && descriptor.operations.query && (
        <p className="text-xs text-muted-foreground">已根据提交地址推导查询地址</p>
      )}
      {endpoints.issues.map((issue) => (
        <p key={issue} className="text-xs text-warning">
          {issue}
        </p>
      ))}
      <button
        type="button"
        className="text-xs text-primary underline"
        aria-expanded={expanded || !!endpoints.issues.length}
        onClick={() => setExpanded(!expanded)}
      >
        逐项设置操作地址
      </button>
      {(expanded || !!endpoints.issues.length) &&
        Object.keys(descriptor.operations).map((key) => (
          <Field key={key} label={`${operationLabels[key as Operation]}地址`}>
            <Input
              value={override.operations?.[key as Operation] ?? ''}
              onChange={(event) => {
                const operations = { ...override.operations };
                if (event.target.value) operations[key as Operation] = event.target.value;
                else delete operations[key as Operation];
                onChange({
                  ...draft,
                  endpointOverride: { ...override, operations, confirmedHosts: [] },
                });
              }}
            />
          </Field>
        ))}
      {endpoints.foreignHosts.map((host) => (
        <label key={host} className="flex items-center gap-2 text-xs text-destructive">
          <Checkbox
            checked={override.confirmedHosts.includes(host)}
            onCheckedChange={(value) =>
              onChange({
                ...draft,
                endpointOverride: {
                  ...override,
                  confirmedHosts:
                    value === true
                      ? [...override.confirmedHosts, host]
                      : override.confirmedHosts.filter((item) => item !== host),
                },
              })
            }
          />
          密钥将发送到 {host}，确认允许
        </label>
      ))}
    </section>
  );
}
