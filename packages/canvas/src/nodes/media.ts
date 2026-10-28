import type {
  CanvasGroupData,
  CanvasMediaData,
  CanvasMediaVersion,
  VideoModeId,
  VideoCap,
} from '@frame-loom/contracts';
import type { InputPort, OutputPort } from '../registry/registry';

/** 未加载模型时仅限制图结构；生成前仍必须经过能力校验。 */
export const DEFAULT_REFERENCE_MAX = 50;

export const imageInputs: readonly InputPort[] = [
  { id: 'reference', label: '参考图', accepts: ['image'], max: DEFAULT_REFERENCE_MAX },
];

export function videoInputs(
  data: Pick<CanvasMediaData, 'mode'>,
  capability?: VideoCap,
): readonly InputPort[] {
  const mode = data.mode ?? capability?.defaultMode ?? 't2v';
  const entry = capability?.modes.find((item) => item.id === mode);
  if (capability && !entry) return [];
  const ports: InputPort[] = [];
  const first =
    mode === 'first' ||
    mode === 'first_last' ||
    (mode === 'reference' && entry?.reference?.withFrames);
  const last =
    mode === 'last' ||
    mode === 'first_last' ||
    (mode === 'reference' && entry?.reference?.withFrames);
  if (first) ports.push({ id: 'first_frame', label: '首帧', accepts: ['image'], max: 1 });
  if (last) ports.push({ id: 'last_frame', label: '尾帧', accepts: ['image'], max: 1 });
  if (mode === 'keyframes')
    ports.push({
      id: 'keyframe',
      label: '关键帧',
      accepts: ['image'],
      max: entry?.keyframes?.max ?? 7,
    });
  if (mode === 'reference' || entry?.withReference)
    ports.push({
      id: 'reference',
      label: '参考素材',
      accepts: entry?.reference?.accept ?? ['image', 'video', 'audio'],
      max: capability?.references.totalCount ?? 50,
    });
  return ports;
}

/** 历史连线可保留在非当前方式端口，提交时由 checkRequest 拒绝。 */
export const retainedVideoInputs: readonly InputPort[] = [
  { id: 'first_frame', label: '首帧', accepts: ['image'], max: 1 },
  { id: 'last_frame', label: '尾帧', accepts: ['image'], max: 1 },
  { id: 'keyframe', label: '关键帧', accepts: ['image'], max: 50 },
  { id: 'reference', label: '参考素材', accepts: ['image', 'video', 'audio'], max: 50 },
];

export const imageOutputs: readonly OutputPort[] = [
  { id: 'out', label: '图片', dataType: 'image' },
];
export const videoOutputs: readonly OutputPort[] = [
  { id: 'out', label: '视频', dataType: 'video' },
];

export function emptyMedia(mode?: VideoModeId): CanvasMediaData {
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
