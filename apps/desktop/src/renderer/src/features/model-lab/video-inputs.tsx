import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  MediaFile,
  ObjectStorageState,
  type GenerationRequest,
  type GenerationInput,
  type ModelProfile,
} from '@frame-loom/contracts';
import { Input } from '@frame-loom/ui/components/input';
import type { EngineClient } from '@/lib/engine-client';

const slots = [
  { kind: 'image', role: 'first_frame', label: '首帧' },
  { kind: 'image', role: 'last_frame', label: '尾帧' },
  { kind: 'image', role: 'reference', label: '参考图' },
  { kind: 'video', role: 'reference', label: '参考视频' },
  { kind: 'audio', role: 'reference', label: '参考音频' },
] as const;

export function VideoInputs({
  client,
  profile,
  mode,
  params,
  inputs,
  onChange,
  onReading,
  disabled,
}: {
  client: EngineClient;
  profile: ModelProfile;
  mode: string;
  params: GenerationRequest['params'];
  inputs: GenerationInput[];
  onChange: (inputs: GenerationInput[]) => void;
  onReading: (reading: boolean) => void;
  disabled: boolean;
}) {
  const storage = useQuery({
    queryKey: ['object-storage'],
    queryFn: ({ signal }) => client.request('/object-storage', ObjectStorageState, { signal }),
  });
  const [reading, setReading] = useState(false);
  const [error, setError] = useState('');
  const active = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      active.current?.abort();
      onReading(false);
    },
    [onReading],
  );
  async function upload(files: FileList | null, slot: (typeof slots)[number]) {
    if (!files?.length) return;
    const controller = new AbortController();
    active.current = controller;
    setReading(true);
    onReading(true);
    setError('');
    try {
      const limit = profile.inputs.find((item) => item.kind === slot.kind)!;
      const list = Array.from(files);
      const other = inputs.filter((input) => input.kind !== slot.kind || input.role !== slot.role);
      if (
        list.length + other.filter((input) => input.kind === slot.kind).length > limit.maxCount ||
        list.some((file) => file.size > limit.maxBytes || !limit.mimeTypes.includes(file.type))
      )
        throw new Error('素材数量、格式或大小超过档案上限');
      const loaded: GenerationInput[] = [];
      for (const file of list) {
        const media = await client.request('/media', MediaFile, {
          method: 'POST',
          body: file,
          signal: controller.signal,
          timeoutMs: 120000,
        });
        if (!media.mime.startsWith(slot.kind + '/')) throw new Error('素材实际类型不匹配');
        loaded.push({ kind: slot.kind, role: slot.role, sha256: media.sha256 });
      }
      if (!controller.signal.aborted) onChange([...other, ...loaded]);
    } catch (failure) {
      if (!controller.signal.aborted)
        setError(failure instanceof Error ? failure.message : '素材上传失败');
    } finally {
      if (!controller.signal.aborted) {
        setReading(false);
        onReading(false);
      }
    }
  }
  return (
    <fieldset className="space-y-3">
      <legend className="mb-2 text-xs text-muted-foreground">参考素材</legend>
      {slots.map((slot) => {
        const limit = profile.inputs.find((item) => item.kind === slot.kind);
        const activeConstraint = profile.constraints.find((constraint) => {
          const { when } = constraint;
          if (when.mode && when.mode !== mode) return false;
          const paramKey = when.param ? String(when.param) : '';
          if (
            paramKey &&
            (params[paramKey] ??
              profile.params.find((param) => param.key === paramKey)?.default) !== when.equals
          )
            return false;
          const inputRole = when.inputRole ? String(when.inputRole) : '';
          if (inputRole && !inputs.some((input) => input.role === inputRole)) return false;
          return constraint.forbidRoles?.includes(slot.role) ?? false;
        });
        const reason =
          mode === 'text'
            ? '文生视频不使用素材'
            : (mode === 'frames') !== (slot.role !== 'reference')
              ? '首尾帧与全模态参考不能混用'
              : !limit || activeConstraint
                ? (activeConstraint?.message ?? '当前档案不支持')
                : (slot.kind !== 'image' || limit.transport === 'url') &&
                    (!storage.data?.hasSecret || storage.data.secretNeedsUpdate)
                  ? '请先在设置中心配置对象存储'
                  : '';
        const count = inputs.filter(
          (input) => input.kind === slot.kind && input.role === slot.role,
        ).length;
        return (
          <label key={slot.label} className="grid gap-1 text-xs text-muted-foreground">
            {slot.label}
            <Input
              aria-label={slot.label}
              type="file"
              accept={limit?.mimeTypes.join(',')}
              multiple={slot.role === 'reference'}
              disabled={disabled || reading || !!reason}
              onClick={(event) => {
                event.currentTarget.value = '';
              }}
              onChange={(event) => void upload(event.target.files, slot)}
            />
            <span>
              {reason ||
                `最多 ${slot.role === 'reference' ? limit?.maxCount : 1} 项，每项 ${Math.floor((limit?.maxBytes ?? 0) / 1024 / 1024)} MiB；已选 ${count} 项`}
            </span>
            {count > 0 && (
              <button
                type="button"
                className="justify-self-start underline"
                disabled={reading || disabled}
                onClick={() =>
                  onChange(
                    inputs.filter((input) => input.kind !== slot.kind || input.role !== slot.role),
                  )
                }
              >
                移除{slot.label}
              </button>
            )}
          </label>
        );
      })}
      {storage.error && (
        <p role="alert" className="text-xs text-destructive">
          {storage.error.message}
        </p>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </fieldset>
  );
}
