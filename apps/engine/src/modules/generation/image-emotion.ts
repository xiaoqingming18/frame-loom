import sharp from 'sharp';

export type FaceBox = { x: number; y: number; width: number; height: number };
export type EditRegion = FaceBox;

export function resolveEditRegion(face: FaceBox, width: number, height: number): EditRegion {
  const x = Math.max(0, Math.floor(face.x - face.width * 0.85));
  const y = Math.max(0, Math.floor(face.y - face.height * 0.75));
  const right = Math.min(width, Math.ceil(face.x + face.width * 1.85));
  const bottom = Math.min(height, Math.ceil(face.y + face.height * 2));
  return { x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y) };
}

export async function emotionArtifacts(source: Buffer, faceInput: FaceBox) {
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
  const crop = await sharp(source)
    .extract({ left: region.x, top: region.y, width: region.width, height: region.height })
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
  const ellipse = ellipseFor(face, region);
  const mask = await sharp({
    create: { width: region.width, height: region.height, channels: 4, background: '#fff' },
  })
    .composite([
      {
        input: Buffer.from(
          `<svg width="${region.width}" height="${region.height}"><ellipse cx="${ellipse.cx}" cy="${ellipse.cy}" rx="${ellipse.rx}" ry="${ellipse.ry}" fill="black"/></svg>`,
        ),
        blend: 'dest-out',
      },
    ])
    .png()
    .toBuffer();
  return { crop, identity, mask, region, face, width: metadata.width, height: metadata.height };
}

export async function compositeEmotion(
  source: Buffer,
  generated: Buffer,
  region: EditRegion,
  face: FaceBox,
) {
  const meta = await sharp(source).metadata();
  if (!meta.width || !meta.height) throw new Error('源图无法读取尺寸');
  const left = Math.max(0, Math.min(meta.width - 1, Math.round(region.x)));
  const top = Math.max(0, Math.min(meta.height - 1, Math.round(region.y)));
  const width = Math.max(1, Math.min(meta.width - left, Math.round(region.width)));
  const height = Math.max(1, Math.min(meta.height - top, Math.round(region.height)));
  const base = await sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const patch = await sharp(generated)
    .resize(width, height, { fit: 'fill', kernel: 'lanczos3' })
    .ensureAlpha()
    .raw()
    .toBuffer();
  const ellipse = ellipseFor(face, { x: left, y: top, width, height });
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

function ellipseFor(face: FaceBox, region: EditRegion) {
  const expandX = face.width * 0.22;
  const expandTop = face.height * 0.28;
  const height = face.height + expandTop + face.height * 0.2;
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
