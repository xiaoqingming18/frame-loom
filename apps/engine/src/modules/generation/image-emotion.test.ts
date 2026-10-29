import { expect, it } from 'vitest';
import sharp from 'sharp';
import { getProtocol } from '@frame-loom/contracts';
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

it('补边与蒙版同尺寸，原尺寸回贴往返像素误差为零，错误比例拒绝', async () => {
  const source = await sharp({
    create: { width: 70, height: 100, channels: 4, background: '#203040' },
  })
    .png()
    .toBuffer();
  const cap = structuredClone(getProtocol('openai-images')!.templates.image!);
  cap.size = {
    wire: 'tier',
    tiers: [{ name: '1K', enabled: true, ratios: [{ ratio: '1:1' }] }],
    default: { tier: '1K', ratio: '1:1' },
  };
  const prepared = await emotionArtifacts(source, { x: 10, y: 10, width: 50, height: 70 }, cap);
  const meta = await sharp(prepared.crop).metadata();
  expect(await sharp(prepared.mask).metadata()).toMatchObject({
    width: meta.width,
    height: meta.height,
  });
  const raw = await sharp(prepared.crop).ensureAlpha().raw().toBuffer();
  expect([...raw.subarray(0, 4)]).toEqual([32, 48, 64, 255]);
  const output = await compositeEmotion(
    source,
    prepared.crop,
    prepared.region,
    prepared.face,
    prepared.geometry,
  );
  expect(await sharp(output).raw().toBuffer()).toEqual(await sharp(source).raw().toBuffer());
  const wrong = await sharp({ create: { width: 40, height: 80, channels: 4, background: '#fff' } })
    .png()
    .toBuffer();
  await expect(
    compositeEmotion(source, wrong, prepared.region, prepared.face, prepared.geometry),
  ).rejects.toThrow('输出比例');
});

it('平移 6px 后环带对齐回原位，椭圆外逐字节一致', async () => {
  const width = 160,
    height = 180;
  const pixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 4;
      pixels[index] = (x * 13 + y * 7) % 256;
      pixels[index + 1] = (x * 3 + y * 17) % 256;
      pixels[index + 2] = (x * 11 + y * 5) % 256;
      pixels[index + 3] = 255;
    }
  const source = await sharp(pixels, { raw: { width, height, channels: 4 } })
    .png()
    .toBuffer();
  const extended = await sharp(source)
    .extend({ left: 6, right: 0, top: 0, bottom: 0, background: '#000' })
    .png()
    .toBuffer();
  const shifted = await sharp(extended)
    .extract({ left: 0, top: 0, width, height })
    .png()
    .toBuffer();
  const region = { x: 0, y: 0, width, height };
  const geometry = {
    crop: region,
    pad: { left: 0, right: 0, top: 0, bottom: 0 },
    expected: { ratio: width / height },
  };
  const output = await compositeEmotion(
    source,
    shifted,
    region,
    { x: 50, y: 50, width: 55, height: 65 },
    geometry,
  );
  expect(await sharp(output).raw().toBuffer()).toEqual(pixels);
});

it('旧配方使用等比裁切并记录诊断', async () => {
  const source = await sharp({
    create: { width: 80, height: 100, channels: 4, background: '#203040' },
  })
    .png()
    .toBuffer();
  const generated = await sharp({
    create: { width: 100, height: 100, channels: 4, background: '#304050' },
  })
    .png()
    .toBuffer();
  const messages: string[] = [];
  const output = await compositeEmotion(
    source,
    generated,
    { x: 0, y: 0, width: 80, height: 100 },
    { x: 20, y: 20, width: 40, height: 50 },
    undefined,
    (message) => messages.push(message),
  );
  expect(await sharp(output).metadata()).toMatchObject({ width: 80, height: 100 });
  expect(messages[0]).toContain('降级');
});

it('4096×4096 合成与对齐耗时', async () => {
  const source = await sharp({
    create: { width: 4096, height: 4096, channels: 4, background: '#203040' },
  })
    .png()
    .toBuffer();
  const start = performance.now();
  const prepared = await emotionArtifacts(source, { x: 1300, y: 1000, width: 900, height: 1100 });
  const output = await compositeEmotion(
    source,
    prepared.crop,
    prepared.region,
    prepared.face,
    undefined,
  );
  console.info(`4096×4096 准备、合成与对齐：${Math.round(performance.now() - start)}ms`);
  expect(await sharp(output).metadata()).toMatchObject({ width: 4096, height: 4096 });
}, 20000);
