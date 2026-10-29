import { expect, it } from 'vitest';
import sharp from 'sharp';
import { blendPanoramaSeam } from './image-panorama.js';

it('校正接缝、保持带外和 alpha 不变、结果确定', async () => {
  const width = 400,
    height = 200;
  const raw = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 4;
      raw[index] = raw[index + 1] = raw[index + 2] = x < width / 2 ? 180 : 80;
      raw[index + 3] = 255;
    }
  const png = await sharp(raw, { raw: { width, height, channels: 4 } })
    .png()
    .toBuffer();
  const result = await blendPanoramaSeam(png);
  expect(result.message).toContain('100.00 → 0.00');
  expect((await blendPanoramaSeam(png)).image).toEqual(result.image);
  const pixels = await sharp(result.image).raw().toBuffer();
  for (let y = 0; y < height; y++) {
    expect(pixels.subarray((y * width + 8) * 4, (y * width + width - 8) * 4)).toEqual(
      raw.subarray((y * width + 8) * 4, (y * width + width - 8) * 4),
    );
    expect(
      Math.abs(pixels[y * width * 4] - pixels[(y * width + width - 1) * 4]),
    ).toBeLessThanOrEqual(2);
  }
});

it('非全景返回原始字节并诊断', async () => {
  const input = await sharp({
    create: { width: 32, height: 32, channels: 4, background: '#123456' },
  })
    .png()
    .toBuffer();
  const result = await blendPanoramaSeam(input);
  expect(result.image).toBe(input);
  expect(result.message).toContain('输出不是 2:1');
});
