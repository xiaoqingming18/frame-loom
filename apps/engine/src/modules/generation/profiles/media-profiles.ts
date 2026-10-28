import type { ChannelModelWrite, ModelProfile } from '@frame-loom/contracts';
import { DomainError } from '../../../core/http/domain-error.js';
import { imageProfile, imageProfiles } from './image-profiles.js';
import { videoProfiles } from './video-profiles.js';
import { ttsProfiles } from './tts-profiles.js';

export const mediaProfiles = [...imageProfiles, ...videoProfiles, ...ttsProfiles];
/** 旧目录缺少新增字段时沿用执行器硬边界，不能因目录尚未升级而放宽限制。 */
export function executionProfile(profile: ModelProfile): ModelProfile {
  const supported = mediaProfiles.filter((item) => item.protocol === profile.protocol);
  const maxLength = Math.min(
    32000,
    ...supported.flatMap((item) =>
      item.promptMaxLength === undefined ? [] : [item.promptMaxLength],
    ),
  );
  const maxBytes = supported.flatMap((item) =>
    item.promptMaxBytes === undefined ? [] : [item.promptMaxBytes],
  );
  return {
    ...profile,
    ...(profile.imageEditCapabilities
      ? {
          imageEditCapabilities: {
            ...profile.imageEditCapabilities,
            openAiImageEdit:
              profile.protocol === 'openai-images' && profile.imageEditCapabilities.openAiImageEdit,
            mask: profile.protocol === 'openai-images' && profile.imageEditCapabilities.mask,
          },
        }
      : {}),
    promptMaxLength: Math.min(profile.promptMaxLength ?? maxLength, maxLength),
    ...(maxBytes.length
      ? { promptMaxBytes: Math.min(profile.promptMaxBytes ?? Infinity, ...maxBytes) }
      : {}),
    modes: profile.modes.map((mode) =>
      profile.kind === 'video' && mode.id === 'frames' && !mode.requiredRoles
        ? { ...mode, requiredRoles: ['first_frame'] }
        : mode,
    ),
  };
}
export function mediaProfile(
  model: Pick<ChannelModelWrite, 'kind' | 'protocol' | 'profileId' | 'upstreamModelId'> & {
    effectiveProfile?: ModelProfile | null;
  },
): ModelProfile {
  if (model.kind === 'tts') {
    const exact = ttsProfiles.find(
      (profile) =>
        profile.protocol === model.protocol && profile.matchIds.includes(model.upstreamModelId),
    );
    if (exact) {
      const profile = model.effectiveProfile ?? exact;
      const voices = exact.params.find((param) => param.key === 'voice')?.values;
      return executionProfile({
        ...profile,
        params: profile.params.map((param) =>
          param.key === 'voice' && voices
            ? {
                ...param,
                values: (param.values ?? voices).filter((value) => voices.includes(value)),
              }
            : param,
        ),
      });
    }
  }
  if (model.effectiveProfile) return executionProfile(model.effectiveProfile);
  if (model.kind === 'image') return executionProfile(imageProfile(model));
  const profiles = mediaProfiles.filter(
    (profile) => profile.kind === model.kind && profile.protocol === model.protocol,
  );
  if (!profiles.length) throw new DomainError('INVALID_PROTOCOL', 422, '请选择支持的生成协议');
  const selected = model.profileId
    ? profiles.find((profile) => profile.id === model.profileId)
    : (profiles.find((profile) => profile.matchIds.includes(model.upstreamModelId)) ??
      profiles.find((profile) => profile.generic));
  if (!selected) throw new DomainError('INVALID_PROFILE', 422, '档案不存在或与模型协议不匹配');
  const exact = profiles.find((profile) => profile.matchIds.includes(model.upstreamModelId));
  if (model.protocol === 'fastaitoken-video' && exact && selected.id !== exact.id)
    throw new DomainError('INVALID_PROFILE', 422, 'FastAIToken 已知型号必须使用对应的精确能力档案');
  return executionProfile(selected);
}
