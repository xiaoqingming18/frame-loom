import { expect, it } from 'vitest';
import sharp from 'sharp';
import { compositeEmotion, emotionArtifacts, resolveEditRegion } from './image-emotion.js';

it('裁切、身份参考和蒙版在边缘人脸坐标内并输出透明椭圆', async () => {
  const source = await sharp({
    create: { width: 24, height: 20, channels: 4, background: '#202020' },
  })
    .png()
    .toBuffer();
  const result = await emotionArtifacts(source, { x: 0, y: 0, width: 8, height: 8 });
  expect(result.region).toEqual(resolveEditRegion({ x: 0, y: 0, width: 8, height: 8 }, 24, 20));
  expect(await sharp(result.identity).metadata()).toMatchObject({
    width: 384,
    height: 384,
    format: 'jpeg',
  });
  const mask = await sharp(result.mask).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  expect(mask.info).toMatchObject({
    width: result.region.width,
    height: result.region.height,
    channels: 4,
  });
  expect(mask.data.some((value, index) => index % 4 === 3 && value === 0)).toBe(true);
});

it('羽化椭圆外保持源像素且合成整图尺寸不变', async () => {
  const source = await sharp({
    create: { width: 40, height: 32, channels: 4, background: '#203040' },
  })
    .png()
    .toBuffer();
  const generated = await sharp({
    create: { width: 20, height: 24, channels: 4, background: '#e03020' },
  })
    .png()
    .toBuffer();
  const region = { x: 10, y: 4, width: 20, height: 24 };
  const face = { x: 15, y: 8, width: 10, height: 10 };
  const output = await compositeEmotion(source, generated, region, face);
  const result = await sharp(output).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const original = await sharp(source).ensureAlpha().raw().toBuffer();
  expect(result.info).toMatchObject({ width: 40, height: 32 });
  expect(result.data.subarray(0, 4)).toEqual(original.subarray(0, 4));
  expect(result.data.subarray((31 * 40 + 39) * 4, (31 * 40 + 39) * 4 + 4)).toEqual(
    original.subarray((31 * 40 + 39) * 4, (31 * 40 + 39) * 4 + 4),
  );
  expect(result.data.some((value, index) => index % 4 === 0 && value > 100)).toBe(true);
});
