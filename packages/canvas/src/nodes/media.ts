import type {
  CanvasGroupData,
  CanvasMediaData,
  CanvasMediaVersion,
  CanvasVideoMode,
} from '@frame-loom/contracts';
import type { InputPort, OutputPort } from '../registry/registry';

/** 图结构允许的参考数量上限，生成前再按模型档案收紧。 */
export const DEFAULT_REFERENCE_MAX = 16;

export const VIDEO_MODES: { id: CanvasVideoMode; label: string }[] = [
  { id: 'text', label: '文生视频' },
  { id: 'frames', label: '首尾帧' },
  { id: 'reference', label: '参考生视频' },
];

export const imageInputs: readonly InputPort[] = [
  { id: 'reference', label: '参考图', accepts: ['image'], max: DEFAULT_REFERENCE_MAX },
];

export function videoInputs(mode: CanvasVideoMode = 'text'): readonly InputPort[] {
  if (mode === 'frames')
    return [
      { id: 'first_frame', label: '首帧', accepts: ['image'], max: 1 },
      { id: 'last_frame', label: '尾帧', accepts: ['image'], max: 1 },
    ];
  if (mode === 'reference')
    return [
      {
        id: 'reference',
        label: '参考素材',
        accepts: ['image', 'video', 'audio'],
        max: DEFAULT_REFERENCE_MAX,
      },
    ];
  return [];
}

export const imageOutputs: readonly OutputPort[] = [
  { id: 'out', label: '图片', dataType: 'image' },
];
export const videoOutputs: readonly OutputPort[] = [
  { id: 'out', label: '视频', dataType: 'video' },
];

export function emptyMedia(mode?: CanvasVideoMode): CanvasMediaData {
  return { versions: [], activeVersion: 0, prompt: '', inputOrder: [], ...(mode ? { mode } : {}) };
}

export function activeVersion(data: CanvasMediaData): CanvasMediaVersion | undefined {
  return data.versions[data.activeVersion];
}

export function appendVersion(data: CanvasMediaData, version: CanvasMediaVersion): CanvasMediaData {
  const versions = [...data.versions, version].slice(-100);
  return { ...data, versions, activeVersion: versions.length - 1 };
}

/** 按媒体宽高比换算节点尺寸，保持面积接近默认尺寸。 */
export function fitMediaSize(
  width: number | null,
  height: number | null,
  base: { width: number; height: number },
) {
  if (!width || !height) return base;
  const ratio = width / height;
  const area = base.width * base.height;
  const w = Math.round(Math.sqrt(area * ratio));
  return { width: w, height: Math.round(w / ratio) };
}

export const GROUP_COLORS: { id: CanvasGroupData['color']; label: string }[] = [
  { id: 'gray', label: '灰色' },
  { id: 'red', label: '红色' },
  { id: 'orange', label: '橙色' },
  { id: 'yellow', label: '黄色' },
  { id: 'green', label: '绿色' },
  { id: 'cyan', label: '青色' },
  { id: 'blue', label: '蓝色' },
  { id: 'purple', label: '紫色' },
];
