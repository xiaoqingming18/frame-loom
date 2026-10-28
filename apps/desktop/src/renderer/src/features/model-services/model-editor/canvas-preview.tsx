import { useState } from 'react';
import {
  effectiveVideoParams,
  VIDEO_MODE_LABELS,
  type Capability,
  type ProtocolDescriptor,
  type VideoModeId,
} from '@frame-loom/contracts';
import { Button } from '@frame-loom/ui/components/button';
import { NativeSelect } from '@frame-loom/ui/components/native-select';

export function CanvasPreview({
  capability,
  descriptor,
  name,
}: {
  capability: Capability;
  descriptor: ProtocolDescriptor;
  name: string;
}) {
  const [selected, setSelected] = useState<VideoModeId>();
  const cap = capability;
  const mode =
    cap.kind === 'video'
      ? selected && cap.modes.some((item) => item.id === selected)
        ? selected
        : cap.defaultMode
      : undefined;
  return (
    <aside
      className="space-y-4 rounded-xl border border-border bg-muted/30 p-4 text-xs"
      aria-label="画布参数预览"
    >
      <h3 className="font-medium">画布参数预览</h3>
      <p className="truncate font-medium">{name || '模型'}</p>
      <div className="rounded-lg border border-dashed border-border px-3 py-6 text-muted-foreground">
        {cap.kind === 'tts'
          ? '输入需要朗读的文本…'
          : cap.kind === 'chat'
            ? '输入消息…'
            : '描述你想创作的画面…'}
      </div>
      {cap.kind === 'image' && (
        <>
          <p>参考图 0/{cap.references.max ?? '不限'}</p>
          <div className="flex flex-wrap gap-1">
            {cap.size.tiers
              .filter((tier) => tier.enabled)
              .map((tier) => (
                <Button key={tier.name} size="xs" variant="outline">
                  {tier.name}
                </Button>
              ))}
          </div>
          <div className="flex flex-wrap gap-1">
            {cap.size.tiers
              .find((tier) => tier.enabled)
              ?.ratios.map((cell) => (
                <Button key={cell.ratio} size="xs" variant="ghost" title={cell.pixels}>
                  {cell.ratio}
                </Button>
              ))}
          </div>
          {cap.quality && <p>质量：{cap.quality.default}</p>}
          {cap.background?.transparent && <p>透明背景</p>}
        </>
      )}
      {cap.kind === 'video' && (
        <>
          <div className="flex flex-wrap gap-1">
            {cap.modes.map((item) => (
              <Button
                key={item.id}
                size="xs"
                variant={mode === item.id ? 'secondary' : 'ghost'}
                onClick={() => setSelected(item.id)}
              >
                {VIDEO_MODE_LABELS[item.id]}
              </Button>
            ))}
          </div>
          <p className="rounded-lg border border-dashed border-border p-3">
            {mode === 't2v'
              ? '无素材'
              : mode === 'first_last'
                ? '首帧 → 尾帧'
                : mode === 'first'
                  ? '首帧'
                  : mode === 'last'
                    ? '尾帧'
                    : mode === 'edit' || mode === 'extend'
                      ? '待编辑视频'
                      : mode === 'keyframes'
                        ? '关键帧'
                        : '参考素材'}
          </p>
          {(mode === 'reference' || cap.modes.find((item) => item.id === mode)?.withReference) && (
            <p>
              图 0/{cap.references.image?.max ?? '不限'} · 视频 0/
              {cap.references.video?.max ?? '不限'} · 音频 0/{cap.references.audio?.max ?? '不限'}
            </p>
          )}
          {effectiveVideoParams(cap, descriptor, mode!, []).aspectRatios.map((option) => (
            <Button
              key={option.value}
              size="xs"
              variant="outline"
              disabled={option.disabled}
              title={option.reason}
            >
              {option.value}
            </Button>
          ))}
        </>
      )}
      {cap.kind === 'tts' && (
        <>
          <NativeSelect aria-label="预览音色" defaultValue={cap.voices.default}>
            <option value="">音色</option>
            {cap.voices.presets.map((voice) => (
              <option key={voice.id} value={voice.id}>
                {voice.name}
              </option>
            ))}
          </NativeSelect>
          {(['speed', 'pitch', 'volume'] as const)
            .filter((key) => cap[key])
            .map((key) => (
              <p key={key}>
                {key}：{cap[key]?.default}
              </p>
            ))}
          <p>{cap.defaultFormat ?? '输出格式'}</p>
        </>
      )}
      {cap.kind === 'chat' && (
        <>
          <p>{cap.inputModalities.length ? '可添加附件' : '文本输入'}</p>
          {cap.reasoningLevels.length > 0 && <p>推理档位：{cap.reasoningLevels.join(' / ')}</p>}
        </>
      )}
    </aside>
  );
}
