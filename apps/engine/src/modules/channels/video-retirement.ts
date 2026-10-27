import { DomainError } from '../../core/http/domain-error.js';

// 只接受已核对的精确别名；计费变体、Pro/Mini 等不自动视作同一型号。
export const legacyVideoDefinitions: Record<string, string> = {
  'doubao-seedance-2-5-260628': 'seedance-2.5',
  'doubao-seedance-2-5': 'seedance-2.5',
  'doubao-seedance-2-0-260128': 'seedance-2.0',
  'doubao-seedance-2-0': 'seedance-2.0',
  'doubao-seedance-2-0-fast-260128': 'seedance-2.0-fast',
  'doubao-seedance-2-0-fast': 'seedance-2.0-fast',
  'seedance-2.5-token': 'seedance-2.5',
  'seedance-2.0-token': 'seedance-2.0',
  'seedance-2.0-time': 'seedance-2.0',
  'seedance-2.0-fast-token': 'seedance-2.0-fast',
  'seedance-2.0-fast-time': 'seedance-2.0-fast',
  'kling-v4': 'kling-4.0',
  'klingai-v4': 'kling-4.0',
  'kling-v3': 'kling-3.0',
  'klingai-v3': 'kling-3.0',
  'wan-3.0': 'wan-3.0',
  'wan3.0-video': 'wan-3.0',
  'wan-3.0-time': 'wan-3.0',
  'MiniMax-H3': 'minimax-h3',
  'minimax-h3-time': 'minimax-h3',
};
export const retiredVideoIds = [
  'sora-2',
  'sora-2-pro',
  'seedance-2.5-pro-token',
  'seedance-2.0-pro-token',
  'seedance-2.0-mini-token',
  'MiniMax-H3-Highspeed',
  'MiniMax-H3-Lite',
  'MiniMax-H3-Max',
];
export function assertVideoBinding(input: {
  kind?: string | null;
  upstreamModelId: string;
  definitionId?: string | null;
}) {
  if (input.kind !== 'video') return;
  if (
    retiredVideoIds.includes(input.upstreamModelId) ||
    (!input.definitionId && !legacyVideoDefinitions[input.upstreamModelId])
  )
    throw new DomainError(
      'VIDEO_MODEL_RETIRED',
      422,
      '旧视频型号已退出或版本未确认，请选择有效模型定义后重新绑定；历史任务仍可查询和下载',
    );
}
