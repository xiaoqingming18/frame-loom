import sharp from 'sharp';
import type { EditGeometry, ImageCap } from '@frame-loom/contracts';
import { planEditGeometry } from '@frame-loom/contracts';

export type FaceBox = { x: number; y: number; width: number; height: number };
export type EditRegion = FaceBox;

export function resolveEditRegion(face: FaceBox, width: number, height: number): EditRegion {
  const x = Math.max(0, Math.floor(face.x - face.width * 0.85));
  const y = Math.max(0, Math.floor(face.y - face.height * 0.75));
  const right = Math.min(width, Math.ceil(face.x + face.width * 1.85));
  const bottom = Math.min(height, Math.ceil(face.y + face.height * 2));
  return { x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y) };
}

export async function emotionArtifacts(source: Buffer, faceInput: FaceBox, cap?: ImageCap) {
  const metadata = await sharp(source, { limitInputPixels: 268_435_456 }).metadata();
  if (!metadata.width || !metadata.height || metadata.width > 16384 || metadata.height > 16384)
    throw new Error('源图片尺寸无效');
  const face = {
    x: Math.max(0, Math.min(metadata.width - 1, faceInput.x)),
    y: Math.max(0, Math.min(metadata.height - 1, faceInput.y)),
    width: Math.max(1, Math.min(metadata.width - Math.max(0, faceInput.x), faceInput.width)),
    height: Math.max(1, Math.min(metadata.height - Math.max(0, faceInput.y), faceInput.height)),
  };
  const region = resolveEditRegion(face, metadata.width, metadata.height);
  const geometry = cap ? planEditGeometry(cap, region) : undefined;
  const pad = geometry?.pad ?? { left: 0, right: 0, top: 0, bottom: 0 };
  const cropped = await sharp(source)
    .extract({ left: region.x, top: region.y, width: region.width, height: region.height })
    .ensureAlpha()
    .raw()
    .toBuffer();
  const sums = [0, 0, 0];
  let count = 0;
  for (let y = 0; y < region.height; y++)
    for (let x = 0; x < region.width; x++) {
      if (x !== 0 && y !== 0 && x !== region.width - 1 && y !== region.height - 1) continue;
      for (let c = 0; c < 3; c++) sums[c] += cropped[(y * region.width + x) * 4 + c];
      count++;
    }
  const crop = await sharp(cropped, {
    raw: { width: region.width, height: region.height, channels: 4 },
  })
    .extend({
      ...pad,
      background: {
        r: Math.round(sums[0] / count),
        g: Math.round(sums[1] / count),
        b: Math.round(sums[2] / count),
        alpha: 1,
      },
    })
    .png()
    .toBuffer();
  const paddingX = face.width * 0.45;
  const paddingTop = face.height * 0.35;
  const left = Math.max(0, Math.floor(face.x - paddingX));
  const top = Math.max(0, Math.floor(face.y - paddingTop));
  const width = Math.max(1, Math.min(metadata.width - left, Math.ceil(face.width + paddingX * 2)));
  const height = Math.max(1, Math.min(metadata.height - top, Math.ceil(face.height * 2)));
  const identity = await sharp(source)
    .extract({ left, top, width, height })
    .resize(384, 384, { fit: 'contain', background: '#111' })
    .jpeg({ quality: 90 })
    .toBuffer();
  const ellipse = ellipseFor(face, { ...region, x: region.x - pad.left, y: region.y - pad.top });
  const maskWidth = region.width + pad.left + pad.right;
  const maskHeight = region.height + pad.top + pad.bottom;
  const mask = await sharp({
    create: { width: maskWidth, height: maskHeight, channels: 4, background: '#fff' },
  })
    .composite([
      {
        input: Buffer.from(
          `<svg width="${maskWidth}" height="${maskHeight}"><ellipse cx="${ellipse.cx}" cy="${ellipse.cy}" rx="${ellipse.rx}" ry="${ellipse.ry}" fill="black"/></svg>`,
        ),
        blend: 'dest-out',
      },
    ])
    .png()
    .toBuffer();
  return {
    crop,
    identity,
    mask,
    region,
    face,
    geometry,
    width: metadata.width,
    height: metadata.height,
  };
}

export async function compositeEmotion(
  source: Buffer,
  generated: Buffer,
  region: EditRegion,
  face: FaceBox,
  geometry?: EditGeometry,
  diagnose: (message: string) => void = () => {},
) {
  region = geometry?.crop ?? region;
  const meta = await sharp(source).metadata();
  if (!meta.width || !meta.height) throw new Error('源图无法读取尺寸');
  const left = Math.max(0, Math.min(meta.width - 1, Math.round(region.x)));
  const top = Math.max(0, Math.min(meta.height - 1, Math.round(region.y)));
  const width = Math.max(1, Math.min(meta.width - left, Math.round(region.width)));
  const height = Math.max(1, Math.min(meta.height - top, Math.round(region.height)));
  const base = await sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const generatedMeta = await sharp(generated).metadata();
  if (!generatedMeta.width || !generatedMeta.height) throw new Error('表情中间图无法读取尺寸');
  if (
    geometry?.expected.ratio &&
    Math.abs(generatedMeta.width / generatedMeta.height / geometry.expected.ratio - 1) > 0.01
  )
    throw new Error(
      '表情后处理失败：输出比例与请求相差超过 1%，请检查供应商尺寸支持；可重试合成，中间图已保留',
    );
  if (!geometry) diagnose('旧表情任务缺少 geometry，使用等比缩放与居中裁切降级');
  const pad = geometry?.pad ?? { left: 0, right: 0, top: 0, bottom: 0 };
  const patch = await sharp(generated)
    .resize(width + pad.left + pad.right, height + pad.top + pad.bottom, {
      fit: 'cover',
      kernel: 'lanczos3',
    })
    .extract({ left: pad.left, top: pad.top, width, height })
    .ensureAlpha()
    .raw()
    .toBuffer();
  const ellipse = ellipseFor(face, { x: left, y: top, width, height });
  const aligned = alignPatch(base.data, patch, meta.width, left, top, width, height, ellipse);
  if (aligned.residual > 24) diagnose('模型改动了非编辑区域，对齐后仍存在较大残差');
  patch.set(aligned.data);
  const gains = edgeColorGains(base.data, patch, meta.width, left, top, width, height, ellipse);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const alpha = feather(ellipseDistance(x, y, ellipse));
      if (!alpha) continue;
      const target = ((top + y) * meta.width + left + x) * 4;
      const input = (y * width + x) * 4;
      const correction = 0.42 + (1 - alpha) * 0.58;
      for (let channel = 0; channel < 3; channel++) {
        const adjusted = Math.max(
          0,
          Math.min(255, patch[input + channel] * (1 + (gains[channel] - 1) * correction)),
        );
        base.data[target + channel] = Math.round(
          base.data[target + channel] * (1 - alpha) + adjusted * alpha,
        );
      }
      base.data[target + 3] = Math.round(
        base.data[target + 3] * (1 - alpha) + patch[input + 3] * alpha,
      );
    }
  }
  return sharp(base.data, { raw: { width: meta.width, height: meta.height, channels: 4 } })
    .png()
    .toBuffer();
}

function alignPatch(
  source: Buffer,
  patch: Buffer,
  sourceWidth: number,
  left: number,
  top: number,
  width: number,
  height: number,
  ellipse: ReturnType<typeof ellipseFor>,
) {
  const stride = Math.max(1, Math.ceil(Math.max(width, height) / 160));
  // shortcut: 仅搜索每轴 ±6～12px 平移，真实样本需要尺度校准时再增加缩放搜索。
  const radius = Math.min(12, Math.max(6, Math.round(Math.min(width, height) * 0.03)));
  const gray = (data: Buffer, i: number) =>
    (data[i] * 77 + data[i + 1] * 150 + data[i + 2] * 29) / 256;
  const samples: { x: number; y: number; value: number }[] = [];
  for (let y = radius; y < height - radius; y += stride)
    for (let x = radius; x < width - radius; x += stride) {
      const d = ellipseDistance(x, y, ellipse);
      if (d >= 1 && d <= 1.7)
        samples.push({ x, y, value: gray(source, ((top + y) * sourceWidth + left + x) * 4) });
    }
  let best = { dx: 0, dy: 0, residual: Infinity };
  // 先评估零位移，同误差时保留原位，避免纯色区域漂移。
  const offsets = Array.from({ length: radius * 2 + 1 }, (_, i) => i - radius).sort(
    (a, b) => Math.abs(a) - Math.abs(b),
  );
  for (const dy of offsets)
    for (const dx of offsets) {
      let error = 0;
      for (const sample of samples)
        error += Math.abs(
          sample.value - gray(patch, ((sample.y + dy) * width + sample.x + dx) * 4),
        );
      const residual = samples.length ? error / samples.length : 0;
      if (residual < best.residual) best = { dx, dy, residual };
    }
  if (!best.dx && !best.dy) return { data: patch, residual: best.residual };
  const data = Buffer.from(patch);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const sx = Math.max(0, Math.min(width - 1, x + best.dx));
      const sy = Math.max(0, Math.min(height - 1, y + best.dy));
      patch.copy(data, (y * width + x) * 4, (sy * width + sx) * 4, (sy * width + sx) * 4 + 4);
    }
  return { data, residual: best.residual };
}

function ellipseFor(face: FaceBox, region: EditRegion) {
  const expandX = -face.width * 0.04;
  const expandTop = -face.height * 0.08;
  const height = face.height + expandTop - face.height * 0.06;
  return {
    cx: face.x - region.x + face.width / 2,
    cy: face.y - region.y - expandTop + height / 2,
    rx: (face.width + expandX * 2) / 2,
    ry: height / 2,
  };
}
function ellipseDistance(x: number, y: number, ellipse: ReturnType<typeof ellipseFor>) {
  return Math.hypot((x + 0.5 - ellipse.cx) / ellipse.rx, (y + 0.5 - ellipse.cy) / ellipse.ry);
}
function feather(distance: number) {
  if (distance <= 0.7) return 1;
  if (distance >= 1) return 0;
  const t = (distance - 0.7) / 0.3;
  return 1 - t * t * (3 - 2 * t);
}
function edgeColorGains(
  source: Buffer,
  generated: Buffer,
  sourceWidth: number,
  left: number,
  top: number,
  width: number,
  height: number,
  ellipse: ReturnType<typeof ellipseFor>,
) {
  const sourceSum = [0, 0, 0];
  const generatedSum = [0, 0, 0];
  let count = 0;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const distance = ellipseDistance(x, y, ellipse);
      if (distance < 0.72 || distance > 0.96) continue;
      const a = ((top + y) * sourceWidth + left + x) * 4;
      const b = (y * width + x) * 4;
      for (let channel = 0; channel < 3; channel++) {
        sourceSum[channel] += source[a + channel];
        generatedSum[channel] += generated[b + channel];
      }
      count++;
    }
  return count < 32
    ? [1, 1, 1]
    : sourceSum.map((sum, channel) =>
        Math.max(0.78, Math.min(1.22, sum / Math.max(1, generatedSum[channel]))),
      );
}
