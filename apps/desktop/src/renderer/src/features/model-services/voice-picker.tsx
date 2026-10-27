import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { VoiceDirectory } from '@frame-loom/contracts';
import { Button } from '@frame-loom/ui/components/button';
import { Input } from '@frame-loom/ui/components/input';
import { NativeSelect } from '@frame-loom/ui/components/native-select';
import type { EngineClient } from '@/lib/engine-client';

export function VoicePicker({
  client,
  modelId,
  value,
  onChange,
}: {
  client: EngineClient;
  modelId: string;
  value: string;
  onChange: (param: string, value: string) => void;
}) {
  const queryClient = useQueryClient();
  const queryKey = ['models', 'voices', modelId];
  const directory = useQuery({
    queryKey,
    queryFn: ({ signal }) =>
      client.request(`/channel-models/${modelId}/voices`, VoiceDirectory, { signal }),
  });
  const [remote, setRemote] = useState<VoiceDirectory>();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function perform(path: string, method: 'POST' | 'DELETE', body?: unknown) {
    setBusy(true);
    setError('');
    try {
      const result = await client.request(`/channel-models/${modelId}/${path}`, VoiceDirectory, {
        method,
        body,
      });
      if (path === 'voice-catalog') setRemote(result);
      else await queryClient.invalidateQueries({ queryKey });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '音色操作失败');
    } finally {
      setBusy(false);
    }
  }
  const data = directory.data;
  const voices = [...(data?.voices ?? []), ...(remote?.voices ?? [])];
  return (
    <div className="space-y-3 rounded-lg border border-border p-3">
      <label className="grid gap-1.5 text-xs text-muted-foreground">
        音色目录
        <NativeSelect
          disabled={busy || !data}
          value={voices.some((voice) => voice.voiceId === value) ? value : ''}
          onChange={(event) => onChange(data!.param, event.target.value)}
        >
          <option value="">请选择音色{data?.canManual ? '，或手填 ID' : ''}</option>
          {[...new Map(voices.map((voice) => [voice.voiceId, voice])).values()].map((voice) => (
            <option key={voice.voiceId} value={voice.voiceId}>
              {voice.name} ·{' '}
              {voice.source === 'saved' ? '已保存' : voice.source === 'builtin' ? '内置' : '供应商'}
            </option>
          ))}
        </NativeSelect>
      </label>
      {data?.canManual && (
        <label className="grid gap-1.5 text-xs text-muted-foreground">
          音色 ID
          <Input
            value={value}
            maxLength={300}
            onChange={(event) => onChange(data.param, event.target.value)}
          />
        </label>
      )}
      {data?.canFetch && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => void perform('voice-catalog', 'POST')}
        >
          拉取供应商音色
        </Button>
      )}
      <label className="grid gap-1.5 text-xs text-muted-foreground">
        音色名称
        <Input value={name} maxLength={100} onChange={(event) => setName(event.target.value)} />
      </label>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy || !value.trim() || !name.trim()}
          onClick={() => void perform('voices', 'POST', { voiceId: value, name })}
        >
          保存到当前账号与模型
        </Button>
        {data?.voices
          .filter((voice) => voice.source === 'saved' && voice.voiceId === value)
          .map((voice) => (
            <Button
              key={voice.id}
              type="button"
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => void perform(`voices/${voice.id}`, 'DELETE')}
            >
              移除已保存音色
            </Button>
          ))}
      </div>
      {(error || directory.error) && (
        <p role="alert" className="text-xs text-destructive">
          {error || directory.error?.message}
        </p>
      )}
    </div>
  );
}
