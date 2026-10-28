import type { ImageCap } from './capabilities.js';
import type { ImageSizeRule } from './protocols.js';
import type { SemanticParams } from './semantic-request.js';

export function defaultTierPixels(
  rule: ImageSizeRule,
  tier: string,
  ratio: string,
): string | undefined {
  if (rule.kind === 'provider') return undefined;
  const table = rule.table?.[tier]?.[ratio];
  if (table) return table;
  if (!Object.hasOwn(rule.tiers, tier)) return undefined;
  const [rw, rh] = ratio.split(':').map(Number);
  const aspect = rw / rh;
  if (
    !(aspect > 0) ||
    !Number.isFinite(aspect) ||
    (rule.maxAspect !== undefined && Math.max(aspect, 1 / aspect) > rule.maxAspect)
  )
    return undefined;
  let width = Math.sqrt(rule.tiers[tier] * aspect);
  let height = Math.sqrt(rule.tiers[tier] / aspect);
  if (rule.maxEdge && Math.max(width, height) > rule.maxEdge) {
    const scale = rule.maxEdge / Math.max(width, height);
    width *= scale;
    height *= scale;
  }
  const step = rule.multipleOf;
  const align = (v: number, round = Math.round) => round(v / step) * step;
  let w = align(width);
  let h = align(height);
  if (w * h > rule.maxPixels) {
    w = align(width, Math.floor);
    h = align(height, Math.floor);
  }
  if (w * h < rule.minPixels) {
    w = align(width, Math.ceil);
    h = align(height, Math.ceil);
  }
  const valid = (cw: number, ch: number) =>
    cw > 0 &&
    ch > 0 &&
    cw * ch >= rule.minPixels &&
    cw * ch <= rule.maxPixels &&
    (!rule.maxEdge || Math.max(cw, ch) <= rule.maxEdge) &&
    (!rule.maxAspect || Math.max(cw / ch, ch / cw) <= rule.maxAspect) &&
    Math.abs(cw / ch / aspect - 1) < 0.01;
  if (!valid(w, h)) {
    const candidates: { w: number; h: number; distance: number }[] = [];
    for (const dw of [-step, 0, step])
      for (const dh of [-step, 0, step]) {
        const cw = w + dw;
        const ch = h + dh;
        if (valid(cw, ch))
          candidates.push({ w: cw, h: ch, distance: (cw - width) ** 2 + (ch - height) ** 2 });
      }
    const closest = candidates.sort((a, b) => a.distance - b.distance)[0];
    if (!closest) return undefined;
    w = closest.w;
    h = closest.h;
  }
  return `${w}x${h}`;
}
export type ResolvedImageSize = {
  wire: ImageCap['size']['wire'];
  width?: number;
  height?: number;
  tier?: string;
  ratio?: string;
  issue?: string;
};
export function resolveImageSize(
  cap: ImageCap,
  params: SemanticParams,
  hasReference: boolean,
): ResolvedImageSize {
  const { size } = cap;
  const result: ResolvedImageSize = { wire: size.wire };
  if (size.wire === 'none') return result;
  const tier = params.tier ?? size.default.tier;
  const ratio = params.aspectRatio ?? size.default.ratio;
  const entry = size.tiers.find((item) => item.name === tier && item.enabled);
  const cell = entry?.ratios.find((item) => item.ratio === ratio);
  if (size.wire === 'tier') {
    if (!entry || !cell) return { ...result, issue: '请选择已启用的档位和比例' };
    return { ...result, tier, ratio };
  }
  if (size.wire === 'ratio') {
    if (
      !ratio ||
      !size.tiers.some(
        (item) => item.enabled && item.ratios.some((candidate) => candidate.ratio === ratio),
      )
    )
      return { ...result, issue: '请选择支持的比例' };
    return { ...result, ratio };
  }
  if (
    params.width === undefined &&
    params.height === undefined &&
    size.default.auto &&
    tier === undefined &&
    ratio === undefined
  )
    return result;
  const custom = params.width !== undefined || params.height !== undefined;
  if (custom && !size.custom) return { ...result, issue: '不支持自定义尺寸' };
  const [width, height] = custom
    ? [params.width, params.height]
    : (cell?.pixels?.split('x').map(Number) ?? []);
  if (
    !width ||
    !height ||
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1
  )
    return { ...result, issue: '请填写有效的像素宽高' };
  const limits = custom ? size.custom : undefined;
  const area = width * height;
  if (
    limits &&
    ((limits.minEdge !== undefined && Math.min(width, height) < limits.minEdge) ||
      (limits.maxEdge !== undefined && Math.max(width, height) > limits.maxEdge) ||
      (limits.multipleOf !== undefined &&
        (limits.multipleOf === 0 ||
          width % limits.multipleOf !== 0 ||
          height % limits.multipleOf !== 0)) ||
      (limits.minPixels !== undefined && area < limits.minPixels) ||
      (limits.maxPixels !== undefined && area > limits.maxPixels) ||
      (limits.maxAspect !== undefined &&
        Math.max(width / height, height / width) > limits.maxAspect))
  )
    return { ...result, issue: '自定义尺寸超出能力卡限制' };
  if (
    hasReference &&
    size.withReference?.maxPixels !== undefined &&
    area > size.withReference.maxPixels
  )
    return { ...result, issue: '带参考图时像素超过上限' };
  return { ...result, width, height, ...(tier ? { tier } : {}), ...(ratio ? { ratio } : {}) };
}
