import type { ModelKind } from '@frame-loom/contracts';

export const kindLabels: Record<ModelKind, string> = {
  chat: '文本',
  image: '图像',
  video: '视频',
  tts: 'TTS',
};
