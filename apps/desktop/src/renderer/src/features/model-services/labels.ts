import type { ModelKind } from '@frame-loom/contracts';

export const kindLabels: Record<ModelKind, string> = {
  chat: '文本',
  image: '图片',
  video: '视频',
  tts: '语音',
};
