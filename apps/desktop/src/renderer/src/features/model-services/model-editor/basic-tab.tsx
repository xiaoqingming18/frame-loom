import { useState } from 'react';
import {
  emptyCapability,
  getProtocol,
  validateModel,
  type CapabilityIssue,
} from '@frame-loom/contracts';
import { ModelKind, type Channel, type ModelWrite } from '@frame-loom/contracts';
import { Button } from '@frame-loom/ui/components/button';
import { Input } from '@frame-loom/ui/components/input';
import { NativeSelect } from '@frame-loom/ui/components/native-select';
import { Switch } from '@frame-loom/ui/components/switch';
import { kindLabels } from '../labels';
import { ConfirmDialog, Field } from '../form-fields';
import { ProtocolPicker } from './protocol-picker';
import { EndpointSection } from './endpoint-section';

export function BasicTab({
  channel,
  draft,
  onChange,
  onProtocol,
  onOpenStorage,
  storageReady,
}: {
  channel: Channel;
  draft: ModelWrite;
  onChange: (value: ModelWrite) => void;
  onProtocol: (id: string) => void;
  onOpenStorage: () => void;
  storageReady: boolean;
}) {
  const [kind, setKind] = useState<ModelKind>();
  const descriptor = draft.protocolId ? getProtocol(draft.protocolId) : undefined;
  let issues: CapabilityIssue[];
  try {
    issues = validateModel({ ...draft, enabled: true }, descriptor, channel);
  } catch {
    issues = [{ field: 'endpointOverride', message: '请填写有效的请求地址' }];
  }
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2" role="group" aria-label="模型类别">
        {ModelKind.options.map((value) => (
          <Button
            key={value}
            size="sm"
            variant={draft.kind === value ? 'secondary' : 'ghost'}
            aria-pressed={draft.kind === value}
            onClick={() => {
              if (value !== draft.kind) setKind(value);
            }}
          >
            {kindLabels[value]}
          </Button>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="上游模型 ID">
          <Input
            value={draft.upstreamModelId}
            onChange={(event) => onChange({ ...draft, upstreamModelId: event.target.value })}
          />
        </Field>
        <Field label="显示名">
          <Input
            value={draft.displayName}
            onChange={(event) => onChange({ ...draft, displayName: event.target.value })}
          />
        </Field>
      </div>
      <ProtocolPicker kind={draft.kind} value={draft.protocolId} onChange={onProtocol} />
      <EndpointSection channel={channel} draft={draft} onChange={onChange} />
      {draft.kind !== 'chat' && descriptor && (
        <section className="space-y-3">
          <h3 className="text-sm font-medium">参考素材传输</h3>
          {(['image', 'video', 'audio'] as const)
            .filter((kind) => descriptor.transports[kind])
            .map((kind) => (
              <Field
                key={kind}
                label={`${{ image: '图片', video: '视频', audio: '音频' }[kind]}传输`}
              >
                <NativeSelect
                  value={draft.transport[kind] ?? 'auto'}
                  onChange={(event) =>
                    onChange({
                      ...draft,
                      transport: { ...draft.transport, [kind]: event.target.value },
                    })
                  }
                >
                  <option value="auto">自动，按协议处理</option>
                  {descriptor.transports[kind]!.allowed.map((value) => (
                    <option key={value} value={value}>
                      {value === 'inline' ? '内联' : '链接（需要对象存储）'}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            ))}
          {Object.values(draft.transport).includes('url') && !storageReady && (
            <p className="text-xs text-warning">
              对象存储未配置。
              <Button variant="link" size="xs" onClick={onOpenStorage}>
                前往对象存储
              </Button>
            </p>
          )}
        </section>
      )}
      <Field label="模型并发（可选）" help={`留空沿用渠道并发，最大 ${channel.concurrency}`}>
        <Input
          type="number"
          min={1}
          max={channel.concurrency}
          placeholder="沿用渠道"
          value={draft.concurrency ?? ''}
          onChange={(event) =>
            onChange({
              ...draft,
              concurrency: event.target.value === '' ? undefined : Number(event.target.value),
            })
          }
        />
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <Switch
          checked={draft.enabled}
          disabled={issues.length > 0}
          onCheckedChange={(enabled) => onChange({ ...draft, enabled })}
        />
        启用模型
      </label>
      {issues.map((issue, index) => (
        <p key={`${issue.field}-${index}`} className="text-xs text-warning">
          {issue.message}
        </p>
      ))}
      {kind && (
        <ConfirmDialog
          title="切换模型类别？"
          description="将清空协议与能力卡"
          onClose={() => setKind(undefined)}
          onConfirm={() => {
            onChange({
              ...draft,
              kind,
              protocolId: null,
              capability: emptyCapability(kind),
              enabled: false,
              extras: [],
              fixedFields: [],
              transport: {},
              endpointOverride: { confirmedHosts: [] },
            });
            setKind(undefined);
          }}
        />
      )}
    </div>
  );
}
