import type { ImageCap } from './capabilities.js';
import type { SemanticParams } from './semantic-request.js';
import { resolveImageSize } from './image-size.js';

export type EditRect = { x: number; y: number; width: number; height: number };
export type EditGeometry = {
  crop: EditRect;
  pad: { left: number; right: number; top: number; bottom: number };
  expected: { ratio?: number; width?: number; height?: number };
};

export type PanoramaSizePlan = {
  request: SemanticParams;
  expected: EditGeometry['expected'];
  choices: { tier: string; request: SemanticParams; width?: number; height?: number }[];
  issue?: string;
};

export function planPanoramaSize(cap: ImageCap, tier?: string): PanoramaSizePlan {
  const { size } = cap;
  const choices: PanoramaSizePlan['choices'] = [];
  if (size.wire === 'pixels' && size.custom) {
    for (const width of [4096, 3584, 2880, 2048]) {
      const height = width / 2;
      const request = { width, height };
      if (!resolveImageSize(cap, request, true).issue)
        choices.push({ tier: `${width}×${height}`, request, width, height });
    }
  } else if (size.wire !== 'none') {
    for (const entry of size.tiers.filter((entry) => entry.enabled)) {
      for (const cell of entry.ratios) {
        const [width, height] = (
          size.wire === 'pixels' ? (cell.pixels ?? '').split('x') : cell.ratio.split(':')
        ).map(Number);
        const request = { tier: entry.name, aspectRatio: cell.ratio };
        if (
          width > 0 &&
          height > 0 &&
          Math.abs(width / height / 2 - 1) <= 0.01 + Number.EPSILON &&
          !resolveImageSize(cap, request, true).issue
        ) {
          const pixels = cell.pixels?.split('x').map(Number);
          choices.push({
            tier: entry.name,
            request,
            ...(pixels ? { width: pixels[0], height: pixels[1] } : {}),
          });
        }
      }
    }
    choices.sort((a, b) => (b.width ?? 0) * (b.height ?? 0) - (a.width ?? 0) * (a.height ?? 0));
    if (choices.every((choice) => !choice.width)) choices.reverse();
  }
  const selected = tier
    ? choices.find((choice) => choice.tier === tier)
    : (choices.find((choice) => size.custom && choice.width === 2880) ?? choices[0]);
  if (!selected)
    return {
      request: {},
      expected: {},
      choices,
      issue: tier && choices.length ? '请选择可用的全景清晰度' : '能力卡没有 2:1 输出尺寸',
    };
  return {
    request: selected.request,
    expected: {
      ratio: 2,
      ...(selected.width && selected.height
        ? { width: selected.width, height: selected.height }
        : {}),
    },
    choices,
  };
}

export function planEditGeometry(
  cap: ImageCap,
  source: EditRect,
): EditGeometry & { request: SemanticParams } {
  if (
    ![source.x, source.y, source.width, source.height].every(Number.isSafeInteger) ||
    source.x < 0 ||
    source.y < 0 ||
    source.width <= 0 ||
    source.height <= 0 ||
    source.x + source.width > 16384 ||
    source.y + source.height > 16384
  )
    throw new Error('图片编辑区域尺寸无效');
  const crop = { ...source };
  const size = cap.size;
  const aspect = crop.width / crop.height;
  const pad = { left: 0, right: 0, top: 0, bottom: 0 };
  if (size.wire === 'none' || (size.default.auto && !size.default.tier && !size.default.ratio))
    return { crop, pad, request: {}, expected: {} };
  let request: SemanticParams;
  let ratio: number;
  let expected: EditGeometry['expected'];
  if (size.wire === 'pixels' && size.custom) {
    const limits = size.custom;
    ratio = Math.max(
      1 / (limits.maxAspect ?? Infinity),
      Math.min(limits.maxAspect ?? Infinity, aspect),
    );
    const step = limits.multipleOf ?? 1;
    if (step < 1) throw new Error('图片编辑尺寸无可行解：像素倍数无效');
    const cell = size.tiers.find((tier) => tier.enabled && tier.name === size.default.tier)
      ?.ratios[0];
    const [dw, dh] = cell?.pixels?.split('x').map(Number) ?? [1024, 1024];
    const area = dw * dh;
    const maxArea = Math.min(
      limits.maxPixels ?? 16384 ** 2,
      size.withReference?.maxPixels ?? Infinity,
    );
    const maxEdge = Math.min(limits.maxEdge ?? 16384, 16384);
    let best: { width: number; height: number; score: number } | undefined;
    for (let width = step; width <= maxEdge; width += step) {
      const low = Math.max(
        step,
        limits.minEdge ?? 1,
        Math.ceil((limits.minPixels ?? 1) / width),
        width / (ratio * 1.01),
      );
      const high = Math.min(maxEdge, maxArea / width, width / (ratio * 0.99));
      const target = Math.max(low, Math.min(high, area / width));
      for (const height of [Math.floor(target / step) * step, Math.ceil(target / step) * step]) {
        const params = { width, height };
        if (
          height < low ||
          height > high ||
          Math.abs(width / height / ratio - 1) >= 0.01 ||
          resolveImageSize(cap, params, true).issue
        )
          continue;
        const score =
          Math.abs(Math.log((width * height) / area)) + Math.abs(width / height / ratio - 1);
        if (!best || score < best.score) best = { ...params, score };
      }
    }
    if (!best) throw new Error('图片编辑尺寸无可行解：能力卡像素限制不兼容');
    request = { width: best.width, height: best.height };
    // 补边匹配实际整数输出，避免格点舍入积累为回贴变形。
    ratio = best.width / best.height;
    expected = { ratio, width: best.width, height: best.height };
  } else {
    const choices = size.tiers
      .filter((tier) => tier.enabled)
      .flatMap((tier) =>
        tier.ratios.map((cell) => {
          const [w, h] = (
            size.wire === 'pixels' ? (cell.pixels?.replace('x', ':') ?? '') : cell.ratio
          )
            .split(':')
            .map(Number);
          return { request: { tier: tier.name, aspectRatio: cell.ratio }, ratio: w / h };
        }),
      )
      .filter(
        (choice) =>
          Number.isFinite(choice.ratio) &&
          choice.ratio > 0 &&
          !resolveImageSize(cap, choice.request, true).issue,
      );
    choices.sort(
      (a, b) => Math.abs(Math.log(a.ratio / aspect)) - Math.abs(Math.log(b.ratio / aspect)),
    );
    if (!choices[0]) throw new Error('图片编辑尺寸无可行解：没有已启用的有效比例');
    ({ request, ratio } = choices[0]);
    expected = { ratio };
  }
  const width = Math.max(crop.width, Math.round(crop.height * ratio));
  const height = Math.max(crop.height, Math.round(crop.width / ratio));
  if (width > 32768 || height > 32768 || width * height > 268_435_456)
    throw new Error('图片编辑尺寸无可行解：补边画布超过像素处理上限');
  pad.left = Math.floor((width - crop.width) / 2);
  pad.right = width - crop.width - pad.left;
  pad.top = Math.floor((height - crop.height) / 2);
  pad.bottom = height - crop.height - pad.top;
  return { crop, pad, request, expected };
}
