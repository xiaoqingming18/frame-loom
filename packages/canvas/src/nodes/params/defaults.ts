import type { Capability, SemanticParams } from '@frame-loom/contracts';

export function defaultMediaParams(cap: Capability): SemanticParams {
  if (cap.kind === 'image')
    return {
      ...(cap.size.default.tier ? { tier: cap.size.default.tier } : {}),
      ...(cap.size.default.ratio ? { aspectRatio: cap.size.default.ratio } : {}),
      ...(cap.quality ? { quality: cap.quality.default } : {}),
      ...(cap.background ? { background: cap.background.default } : {}),
    };
  if (cap.kind === 'video')
    return {
      ...(cap.defaultAspectRatio ? { aspectRatio: cap.defaultAspectRatio } : {}),
      ...(cap.defaultResolution ? { resolution: cap.defaultResolution } : {}),
      ...(cap.duration.kind !== 'auto' ? { duration: cap.duration.default } : {}),
      ...(cap.audio.mode === 'optional' && cap.audio.default !== undefined
        ? { audio: cap.audio.default }
        : {}),
      ...(cap.watermark ? { watermark: cap.watermark.default } : {}),
    };
  return {};
}
