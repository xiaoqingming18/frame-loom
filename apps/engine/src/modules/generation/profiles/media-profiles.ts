import type { ChannelModelWrite, ModelProfile } from '@frame-loom/contracts';
import { DomainError } from '../../../core/http/domain-error.js';
import { imageProfiles } from './image-profiles.js';
import { videoProfiles } from './video-profiles.js';
import { ttsProfiles } from './tts-profiles.js';

export const mediaProfiles = [...imageProfiles, ...videoProfiles, ...ttsProfiles];
export function mediaProfile(
  model: Pick<ChannelModelWrite, 'kind' | 'protocol' | 'profileId' | 'upstreamModelId'>,
): ModelProfile {
  const profiles = mediaProfiles.filter(
    (profile) => profile.kind === model.kind && profile.protocol === model.protocol,
  );
  if (!profiles.length) throw new DomainError('INVALID_PROTOCOL', 422, '请选择支持的生成协议');
  const selected = model.profileId
    ? profiles.find((profile) => profile.id === model.profileId)
    : (profiles.find((profile) => profile.matchIds.includes(model.upstreamModelId)) ??
      profiles.find((profile) => profile.generic));
  if (!selected) throw new DomainError('INVALID_PROFILE', 422, '档案不存在或与模型协议不匹配');
  return selected;
}
