import { useState } from 'react';
import {
  VIDEO_MODE_LABELS,
  type Capability,
  type ProtocolDescriptor,
  type SemanticParams,
  type VideoModeId,
} from '@frame-loom/contracts';
import { Button } from '@frame-loom/ui/components/button';
import { TooltipProvider } from '@frame-loom/ui/components/tooltip';
import { ImageParams } from './image-params';
import { VideoParams } from './video-params';
import { TtsParams } from './tts-params';
import type { CapabilityParamsProps } from './types';

export function CapabilityParams(props: CapabilityParamsProps) {
  return props.capability.kind === 'image' ? (
    <ImageParams {...props} />
  ) : props.capability.kind === 'video' ? (
    <VideoParams {...props} />
  ) : props.capability.kind === 'tts' ? (
    <TtsParams key={props.modelId} {...props} />
  ) : null;
}

export function CapabilityPreview({
  capability,
  protocol,
}: {
  capability: Capability;
  protocol: ProtocolDescriptor;
}) {
  const [params, setParams] = useState<SemanticParams>({});
  const [selected, setSelected] = useState<VideoModeId>();
  const mode =
    capability.kind === 'video'
      ? (capability.modes.find((item) => item.id === selected)?.id ?? capability.defaultMode)
      : undefined;
  const selectedMode =
    capability.kind === 'video' ? capability.modes.find((item) => item.id === mode) : undefined;
  return (
    <TooltipProvider>
      {capability.kind === 'video' && (
        <div className="mb-3 flex flex-wrap gap-1">
          {capability.modes.map((item) => (
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
      )}
      {capability.kind === 'video' && (mode === 'reference' || selectedMode?.withReference) && (
        <p className="mb-3 text-xs text-muted-foreground">
          图 0/{capability.references.image?.max ?? '不限'} · 视频 0/
          {capability.references.video?.max ?? '不限'} · 音频 0/
          {capability.references.audio?.max ?? '不限'}
        </p>
      )}
      <CapabilityParams
        capability={capability}
        protocol={protocol}
        mode={mode}
        inputs={[]}
        params={params}
        onChange={setParams}
        disabled={false}
        readOnly
      />
    </TooltipProvider>
  );
}
