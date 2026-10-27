import type { ChannelModelWrite, ModelProfile } from '@frame-loom/contracts';
import { DomainError } from '../../../core/http/domain-error.js';
import { imageProfile, imageProfiles } from './image-profiles.js';
import { videoProfiles } from './video-profiles.js';
import { ttsProfiles } from './tts-profiles.js';

export const mediaProfiles = [...imageProfiles, ...videoProfiles, ...ttsProfiles];
export function mediaProfile(
  model: Pick<ChannelModelWrite, 'kind' | 'protocol' | 'profileId' | 'upstreamModelId'>,
): ModelProfile {
  if (model.kind === 'image') return imageProfile(model);
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
  return selected;
}
