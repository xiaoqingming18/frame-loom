import { useContext, useEffect, useState } from 'react';
import type { VoiceDirectory } from '@frame-loom/contracts';
import { Button } from '@frame-loom/ui/components/button';
import { Input } from '@frame-loom/ui/components/input';
import { NativeSelect } from '@frame-loom/ui/components/native-select';
import { Slider } from '@frame-loom/ui/components/slider';
import { Textarea } from '@frame-loom/ui/components/textarea';
import { CanvasContext } from '../../context';
import type { CapabilityParamsProps } from './types';

export function TtsParams({
  capability: cap,
  protocol,
  params,
  onChange,
  modelId,
  disabled,
  readOnly,
}: CapabilityParamsProps) {
  const context = useContext(CanvasContext);
  const api = context?.host.generation;
  const [directory, setDirectory] = useState<VoiceDirectory>();
  const [remote, setRemote] = useState<VoiceDirectory>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  useEffect(() => {
    let live = true;
    if (modelId && api?.voices)
      void api
        .voices(modelId)
        .then((value) => {
          if (live) setDirectory(value);
        })
        .catch((failure: unknown) => {
          if (live) setError(failure instanceof Error ? failure.message : '音色读取失败');
        });
    return () => {
      live = false;
    };
  }, [api, modelId]);
  if (cap.kind !== 'tts') return null;
  const locked = disabled || readOnly || busy;
  const voices = new Map([
    ...cap.voices.presets.map((voice) => [voice.id, voice.name] as const),
    ...(directory?.voices ?? []).map((voice) => [voice.voiceId, voice.name] as const),
    ...(remote?.voices ?? []).map((voice) => [voice.voiceId, voice.name] as const),
  ]);
  const voice = params.voice ?? cap.voices.default ?? '';
  async function perform(fetch: boolean) {
    if (!modelId || !api) return;
    setBusy(true);
    setError('');
    try {
      if (fetch && api.fetchVoices) setRemote(await api.fetchVoices(modelId));
      else if (api.saveVoice) setDirectory(await api.saveVoice(modelId, { voiceId: voice, name }));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '音色操作失败');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-4 text-xs">
      <label className="grid gap-2">
        音色
        <NativeSelect
          aria-label="音色"
          value={voice}
          disabled={locked}
          onChange={(event) => onChange({ ...params, voice: event.target.value })}
        >
          <option value="">请选择音色</option>
          {voice && !voices.has(voice) && <option value={voice}>{voice}</option>}
          {[...voices].map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </NativeSelect>
      </label>
      {cap.voices.sources.includes('remote') && protocol.operations.voices && api?.fetchVoices && (
        <Button size="sm" variant="outline" disabled={locked} onClick={() => void perform(true)}>
          从接口拉取
        </Button>
      )}
      {cap.voices.sources.includes('manual') && (
        <div className="space-y-2">
          <label className="grid gap-2">
            手填 ID
            <Input
              aria-label="音色 ID"
              value={voice}
              maxLength={300}
              disabled={locked}
              onChange={(event) => onChange({ ...params, voice: event.target.value })}
            />
          </label>
          {api?.saveVoice && (
            <>
              <Input
                aria-label="音色名称"
                value={name}
                maxLength={100}
                disabled={locked}
                onChange={(event) => setName(event.target.value)}
                placeholder="音色名称"
              />
              <Button
                size="sm"
                variant="outline"
                disabled={locked || !voice.trim() || !name.trim()}
                onClick={() => void perform(false)}
              >
                保存音色
              </Button>
            </>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      {cap.instructions && (
        <label className="grid gap-2">
          指令文本
          <Textarea
            aria-label="指令文本"
            value={params.instructions ?? ''}
            disabled={locked}
            onChange={(event) => onChange({ ...params, instructions: event.target.value })}
          />
        </label>
      )}
      {(['speed', 'pitch', 'volume'] as const).map((key) => {
        const range = cap[key];
        const label = { speed: '语速', pitch: '音调', volume: '音量' }[key];
        return (
          range && (
            <label key={key} className="grid gap-2">
              {label}：{params[key] ?? range.default}
              <Slider
                aria-label={label}
                min={range.min}
                max={range.max}
                step={0.01}
                value={[params[key] ?? range.default]}
                disabled={locked}
                onValueChange={([value]) => onChange({ ...params, [key]: value })}
              />
            </label>
          )
        );
      })}
      {cap.formats.length > 0 && (
        <label className="grid gap-2">
          输出格式
          <NativeSelect
            aria-label="输出格式"
            value={params.format ?? cap.defaultFormat ?? ''}
            disabled={locked}
            onChange={(event) => onChange({ ...params, format: event.target.value })}
          >
            <option value="">请选择</option>
            {cap.formats.map((format) => (
              <option key={format}>{format}</option>
            ))}
          </NativeSelect>
        </label>
      )}
      {cap.sampleRates.length > 0 && (
        <label className="grid gap-2">
          采样率
          <NativeSelect
            aria-label="采样率"
            value={params.sampleRate ?? cap.defaultSampleRate ?? ''}
            disabled={locked}
            onChange={(event) => onChange({ ...params, sampleRate: Number(event.target.value) })}
          >
            <option value="" disabled>
              请选择
            </option>
            {cap.sampleRates.map((rate) => (
              <option key={rate} value={rate}>
                {rate} Hz
              </option>
            ))}
          </NativeSelect>
        </label>
      )}
    </div>
  );
}
