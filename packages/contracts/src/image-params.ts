import type { GenerationRequest, ModelProfile } from './generation.js';

export const IMAGE_ASPECT_RATIOS = [
  '1:1',
  '16:9',
  '9:16',
  '3:4',
  '4:3',
  '3:2',
  '2:3',
  '5:4',
  '4:5',
  '21:9',
  '2:1',
  '1:2',
  '3:1',
  '1:3',
] as const;
export const IMAGE_RESOLUTIONS = ['1K', '2K', '4K'] as const;
export const IMAGE_QUALITIES = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export const IMAGE_BACKGROUNDS = ['auto', 'transparent', 'opaque'] as const;
export type ImageAspectRatio = (typeof IMAGE_ASPECT_RATIOS)[number];
export type ImageResolution = (typeof IMAGE_RESOLUTIONS)[number];
export type ImageQuality = (typeof IMAGE_QUALITIES)[number];
export type ImageBackground = (typeof IMAGE_BACKGROUNDS)[number];
export const IMAGE_PARAM_LABELS = {
  aspectRatio: '比例',
  resolution: '清晰度',
  quality: '画质',
  background: '背景',
} as const;
export const IMAGE_QUALITY_LABELS: Record<ImageQuality, string> = {
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '超高',
  max: '极致',
};
export const IMAGE_BACKGROUND_LABELS: Record<ImageBackground, string> = {
  auto: '自适应',
  transparent: '透明',
  opaque: '不透明',
};
export const DEFAULT_IMAGE_PARAMS = {
  aspectRatio: '1:1',
  resolution: '2K',
  quality: 'medium',
  background: 'auto',
} as const;

type Params = GenerationRequest['params'];
type Value = Params[string];
type Param = ModelProfile['params'][number];
export type ImageParamChange = {
  key: string;
  from: Value;
  to: Value | undefined;
  message: string;
};

function ratio(value: Value): number {
  if (typeof value !== 'string' || !/^\d+:\d+$/.test(value)) return NaN;
  const [width, height] = value.split(':').map(Number);
  return width > 0 && height > 0 ? width / height : NaN;
}

function accepts(param: Param, value: Value): boolean {
  switch (param.type) {
    case 'enum':
      return param.values?.includes(value) ?? false;
    case 'number':
      return (
        typeof value === 'number' &&
        Number.isFinite(value) &&
        (param.min === undefined || value >= param.min) &&
        (param.max === undefined || value <= param.max)
      );
    case 'boolean':
      return typeof value === 'boolean';
    case 'string':
      return typeof value === 'string';
  }
}

function fallback(param: Param, current: Value): Value {
  const values = param.values ?? [];
  if (param.key === 'aspectRatio' && Number.isFinite(ratio(current))) {
    const candidates = values.filter((value) => Number.isFinite(ratio(value)));
    if (candidates.length)
      return candidates.reduce((best, value) =>
        Math.abs(Math.log(ratio(value) / ratio(current))) <
        Math.abs(Math.log(ratio(best) / ratio(current)))
          ? value
          : best,
      );
  }
  if (param.key === 'resolution' || param.key === 'quality') {
    const order: readonly string[] =
      param.key === 'resolution' ? IMAGE_RESOLUTIONS : IMAGE_QUALITIES;
    const index = order.indexOf(String(current));
    const supported = order.filter((value) => values.includes(value));
    if (index >= 0 && supported.length) {
      if (param.key === 'resolution')
        return supported.filter((value) => order.indexOf(value) <= index).at(-1) ?? supported[0];
      return supported.reduce((best, value) =>
        Math.abs(order.indexOf(value) - index) < Math.abs(order.indexOf(best) - index)
          ? value
          : best,
      );
    }
  }
  if (param.key === 'background' && values.includes('auto')) return 'auto';
  return param.default;
}

function label(key: string, value: Value): string {
  if (key === 'quality' && Object.hasOwn(IMAGE_QUALITY_LABELS, String(value)))
    return IMAGE_QUALITY_LABELS[value as ImageQuality];
  if (key === 'background' && Object.hasOwn(IMAGE_BACKGROUND_LABELS, String(value)))
    return IMAGE_BACKGROUND_LABELS[value as ImageBackground];
  return String(value);
}

/** 仅补齐档案声明的参数；缺省值不算模型切换造成的调整。 */
export function resolveImageParams(profile: ModelProfile, current: Params) {
  const params: Params = {};
  const changes: ImageParamChange[] = [];
  for (const param of profile.params) {
    const value = Object.hasOwn(current, param.key) ? current[param.key] : undefined;
    params[param.key] =
      value === undefined ? param.default : accepts(param, value) ? value : fallback(param, value);
  }
  for (const [key, from] of Object.entries(current)) {
    const to = Object.hasOwn(params, key) ? params[key] : undefined;
    if (from === to) continue;
    const name =
      profile.params.find((param) => param.key === key)?.name ??
      (Object.hasOwn(IMAGE_PARAM_LABELS, key)
        ? IMAGE_PARAM_LABELS[key as keyof typeof IMAGE_PARAM_LABELS]
        : key);
    changes.push({
      key,
      from,
      to,
      message:
        to === undefined
          ? `已移除${name}：${label(key, from)}`
          : `${name}：${label(key, from)} → ${label(key, to)}`,
    });
  }
  return { params, changes };
}

// 官方表包含非 16 倍数的值（如 1K 21:9），必须原样保留。
// https://ark.volcengine.com/region:cn-beijing/docs/image-generation-api
export const SEEDREAM_IMAGE_SIZES = {
  '1:1': ['1024x1024', '2048x2048', '4096x4096'],
  '4:3': ['1152x864', '2304x1728', '4704x3520'],
  '3:4': ['864x1152', '1728x2304', '3520x4704'],
  '16:9': ['1280x720', '2848x1600', '5504x3040'],
  '9:16': ['720x1280', '1600x2848', '3040x5504'],
  '3:2': ['1248x832', '2496x1664', '4992x3328'],
  '2:3': ['832x1248', '1664x2496', '3328x4992'],
  '21:9': ['1512x648', '3136x1344', '6240x2656'],
} as const;
const GPT_IMAGE_1_SIZES: Partial<Record<ImageAspectRatio, string>> = {
  '1:1': '1024x1024',
  '3:2': '1536x1024',
  '2:3': '1024x1536',
};

function alignedSize(area: number, aspect: number, min: number, max: number, maxSide?: number) {
  let width = Math.sqrt(area * aspect);
  let height = Math.sqrt(area / aspect);
  if (maxSide && Math.max(width, height) > maxSide) {
    const scale = maxSide / Math.max(width, height);
    width *= scale;
    height *= scale;
  }
  const align = (value: number, round = Math.round) => round(value / 16) * 16;
  let w = align(width);
  let h = align(height);
  if (w * h > max) {
    w = align(width, Math.floor);
    h = align(height, Math.floor);
  }
  if (w * h < min) {
    w = align(width, Math.ceil);
    h = align(height, Math.ceil);
  }
  if (maxSide) {
    if (w > h * 3) w = h * 3;
    if (h > w * 3) h = w * 3;
  }
  // 独立取整在 1K 的 5:4、2:1 等比例上会超过 1% 误差，局部选最近的合法尺寸。
  if (Math.abs(w / h / aspect - 1) >= 0.01) {
    const candidates: { w: number; h: number; distance: number }[] = [];
    for (const dw of [-16, 0, 16])
      for (const dh of [-16, 0, 16]) {
        const cw = w + dw;
        const ch = h + dh;
        if (
          cw <= 0 ||
          ch <= 0 ||
          cw * ch < min ||
          cw * ch > max ||
          Math.abs(cw / ch / aspect - 1) >= 0.01 ||
          (maxSide && (Math.max(cw, ch) > maxSide || Math.max(cw, ch) / Math.min(cw, ch) > 3))
        )
          continue;
        candidates.push({ w: cw, h: ch, distance: (cw - width) ** 2 + (ch - height) ** 2 });
      }
    const closest = candidates.sort((a, b) => a.distance - b.distance)[0];
    if (!closest) throw new Error('无法在尺寸约束内保持目标比例');
    w = closest.w;
    h = closest.h;
  }
  return `${w}x${h}`;
}

/** 根据档案能力换算像素尺寸；Gemini 直接使用语义参数，不发送像素尺寸。 */
export function imageRequestSize(profile: ModelProfile, current: Params): string | undefined {
  if (profile.kind !== 'image') throw new Error('尺寸换算仅支持图片档案');
  if (profile.protocol === 'gemini-image') return undefined;
  const { params } = resolveImageParams(profile, current);
  const aspectRatio = params.aspectRatio as ImageAspectRatio;
  if (!IMAGE_ASPECT_RATIOS.includes(aspectRatio)) throw new Error('图片档案缺少有效比例');
  if (
    profile.protocol === 'openai-images' &&
    !profile.params.some((param) => param.key === 'resolution')
  ) {
    const size = GPT_IMAGE_1_SIZES[aspectRatio];
    if (!size) throw new Error('固定尺寸档案不支持此比例');
    return size;
  }
  const resolution = params.resolution as ImageResolution;
  if (!IMAGE_RESOLUTIONS.includes(resolution)) throw new Error('图片档案缺少有效清晰度');
  if (profile.protocol === 'openai-images') {
    const area = { '1K': 1024 ** 2, '2K': 2560 * 1440, '4K': 8_294_400 }[resolution];
    return alignedSize(area, ratio(aspectRatio), 655_360, 8_294_400, 3840);
  }
  if (profile.protocol === 'ark-images') {
    if (Object.hasOwn(SEEDREAM_IMAGE_SIZES, aspectRatio))
      return SEEDREAM_IMAGE_SIZES[aspectRatio as keyof typeof SEEDREAM_IMAGE_SIZES][
        IMAGE_RESOLUTIONS.indexOf(resolution)
      ];
    const min = profile.params.find((param) => param.key === 'resolution')?.values?.includes('1K')
      ? 921_600
      : 3_686_400;
    return alignedSize(
      { '1K': 1024 ** 2, '2K': 2048 ** 2, '4K': 4096 ** 2 }[resolution],
      ratio(aspectRatio),
      min,
      16_777_216,
    );
  }
  throw new Error('尺寸换算不支持此图片协议');
}
