import type { GenerationInput, GenerationRequest, ModelProfile, MediaFile } from './generation.js';
import { checkGenerationRequest } from './generation.js';

/** 只执行当前已实现的创作操作；新操作需要执行器与 UI 同步实现。 */
export function executableGenerationModes(profile: ModelProfile) {
  return profile.modes.filter((mode) => ['text', 'frames', 'reference'].includes(mode.id));
}

export function generationRoleReason(
  profile: ModelProfile,
  request: Pick<GenerationRequest, 'mode' | 'params' | 'inputs'>,
  role: GenerationInput['role'],
  kind: GenerationInput['kind'],
) {
  if (!executableGenerationModes(profile).some((mode) => mode.id === request.mode))
    return '请先选择当前模型支持的生成模式';
  if (request.mode === 'text') return '文生模式不接受参考素材';
  if (request.mode === 'frames' && role === 'reference') return '首尾帧与全模态参考互斥';
  if (request.mode !== 'frames' && role !== 'reference') return '请切换到首尾帧模式';
  if (role !== 'reference' && kind !== 'image') return '首尾帧必须是图片';
  if (!profile.inputs.some((input) => input.kind === kind && input.maxCount > 0))
    return '当前模型不支持此类素材';
  return profile.constraints.find(
    (rule) =>
      (!rule.when.mode || rule.when.mode === request.mode) &&
      (!rule.when.param ||
        (request.params[rule.when.param] ??
          profile.params.find((param) => param.key === rule.when.param)?.default) ===
          rule.when.equals) &&
      (!rule.when.inputRole ||
        request.inputs.some((input) => input.role === rule.when.inputRole)) &&
      rule.forbidRoles?.includes(role),
  )?.message;
}

export function generationParamReason(
  profile: ModelProfile,
  request: GenerationRequest,
  key: string,
  value: GenerationRequest['params'][string],
) {
  return checkGenerationRequest(profile, {
    ...request,
    params: { ...request.params, [key]: value },
  }).find((issue) => issue.field === key)?.message;
}

export function checkGenerationMedia(
  profile: ModelProfile,
  inputs: { input: GenerationInput; media: Partial<MediaFile> }[],
) {
  const issues: { field: string; message: string }[] = [];
  inputs.forEach(({ input, media }, index) => {
    const limit = profile.inputs.find((entry) => entry.kind === input.kind);
    if (!limit) return;
    const invalid =
      (media.mime !== undefined &&
        (!media.mime.startsWith(`${input.kind}/`) || !limit.mimeTypes.includes(media.mime))) ||
      (media.bytes !== undefined && media.bytes > limit.maxBytes) ||
      (limit.minDurationMs !== undefined &&
        media.durationMs !== undefined &&
        (media.durationMs ?? 0) < limit.minDurationMs) ||
      (limit.maxDurationMs !== undefined &&
        media.durationMs !== undefined &&
        (media.durationMs ?? Infinity) > limit.maxDurationMs) ||
      (limit.minFps !== undefined && media.fps !== undefined && (media.fps ?? 0) < limit.minFps) ||
      (limit.maxFps !== undefined &&
        media.fps !== undefined &&
        (media.fps ?? Infinity) > limit.maxFps) ||
      (limit.codecs && media.codec !== undefined && !limit.codecs.includes(media.codec ?? '')) ||
      (limit.audioCodecs && media.audioCodec && !limit.audioCodecs.includes(media.audioCodec)) ||
      (media.width != null &&
        ((limit.minWidth !== undefined && media.width < limit.minWidth) ||
          (limit.maxWidth !== undefined && media.width > limit.maxWidth))) ||
      (media.height != null &&
        ((limit.minHeight !== undefined && media.height < limit.minHeight) ||
          (limit.maxHeight !== undefined && media.height > limit.maxHeight))) ||
      (media.width !== undefined &&
        media.height !== undefined &&
        ((limit.minRatio !== undefined &&
          (media.width ?? 0) / (media.height ?? 1) < limit.minRatio) ||
          (limit.maxRatio !== undefined &&
            (media.width ?? Infinity) / (media.height ?? 1) > limit.maxRatio)));
    if (invalid)
      issues.push({
        field: `inputs.${index}`,
        message: `素材 ${index + 1} 的格式、大小、尺寸、时长、帧率或编码不符合模型限制`,
      });
  });
  for (const limit of profile.inputs) {
    const duration = inputs
      .filter(({ input }) => input.kind === limit.kind)
      .reduce((sum, { media }) => sum + (media.durationMs ?? 0), 0);
    if (limit.maxTotalDurationMs !== undefined && duration > limit.maxTotalDurationMs)
      issues.push({
        field: 'inputs',
        message: `${limit.kind}参考素材总时长超过 ${limit.maxTotalDurationMs / 1000} 秒`,
      });
  }
  return issues;
}
