import { describe, expect, it } from 'vitest';
import { defaultTierPixels, resolveImageSize } from './image-size.js';
import { SEEDREAM_IMAGE_SIZES, IMAGE_ASPECT_RATIOS } from './image-params.js';
import type { ImageSizeRule } from './protocols.js';
import type { ImageCap } from './capabilities.js';

const rule: ImageSizeRule = {
  kind: 'area',
  tiers: { '1K': 1024 ** 2, '2K': 2560 * 1440, '4K': 8294400 },
  multipleOf: 16,
  minPixels: 655360,
  maxPixels: 8294400,
  maxEdge: 3840,
  maxAspect: 3,
};
const cap: ImageCap = {
  kind: 'image',
  references: { formats: [] },
  count: {},
  size: {
    wire: 'pixels',
    tiers: [{ name: '1K', enabled: true, ratios: [{ ratio: '1:1', pixels: '1024x1024' }] }],
    default: { tier: '1K', ratio: '1:1' },
    custom: { minEdge: 16, maxEdge: 4096, multipleOf: 16, maxPixels: 4194304 },
    withReference: { maxPixels: 1048576 },
  },
  outputFormats: [],
  seed: false,
  negativePrompt: false,
};
describe('图片尺寸', () => {
  it('面积规则保持原像素和比例误差', () => {
    expect(defaultTierPixels(rule, '2K', '1:1')).toBe('1920x1920');
    for (const tier of ['1K', '2K', '4K'])
      for (const ratio of IMAGE_ASPECT_RATIOS) {
        const [w, h] = defaultTierPixels(rule, tier, ratio)!.split('x').map(Number);
        const [rw, rh] = ratio.split(':').map(Number);
        expect(w % 16).toBe(0);
        expect(h % 16).toBe(0);
        expect(w * h).toBeGreaterThanOrEqual(655360);
        expect(w * h).toBeLessThanOrEqual(8294400);
        expect(Math.max(w, h)).toBeLessThanOrEqual(3840);
        expect(Math.abs(w / h / (rw / rh) - 1)).toBeLessThan(0.01);
      }
  });
  it('Seedream 查表原样保留，未知档位与 provider 不猜测', () => {
    const table = Object.fromEntries(
      ['1K', '2K', '4K'].map((tier, index) => [
        tier,
        Object.fromEntries(
          Object.entries(SEEDREAM_IMAGE_SIZES).map(([ratio, sizes]) => [ratio, sizes[index]]),
        ),
      ]),
    );
    expect(defaultTierPixels({ ...rule, table }, '1K', '21:9')).toBe('1512x648');
    expect(defaultTierPixels(rule, '1k', '1:1')).toBeUndefined();
    expect(defaultTierPixels({ kind: 'provider' }, '1K', '1:1')).toBeUndefined();
  });
  it('像素、档位、比例、none 四种发送形态', () => {
    expect(resolveImageSize(cap, {}, false)).toMatchObject({ width: 1024, height: 1024 });
    expect(resolveImageSize({ ...cap, size: { ...cap.size, wire: 'tier' } }, {}, false)).toEqual({
      wire: 'tier',
      tier: '1K',
      ratio: '1:1',
    });
    expect(resolveImageSize({ ...cap, size: { ...cap.size, wire: 'ratio' } }, {}, false)).toEqual({
      wire: 'ratio',
      ratio: '1:1',
    });
    expect(resolveImageSize({ ...cap, size: { ...cap.size, wire: 'none' } }, {}, false)).toEqual({
      wire: 'none',
    });
  });
  it('未知格要求手填，自定义与参考图上限均检查', () => {
    expect(resolveImageSize(cap, { tier: 'unknown' }, false).issue).toBeTruthy();
    expect(resolveImageSize(cap, { width: 17, height: 16 }, false).issue).toBeTruthy();
    expect(resolveImageSize(cap, { width: 2048, height: 2048 }, false).issue).toBeUndefined();
    expect(resolveImageSize(cap, { width: 2048, height: 2048 }, true).issue).toContain('参考图');
    expect(resolveImageSize(cap, { width: 8192, height: 8192 }, false).issue).toBeTruthy();
    expect(resolveImageSize(cap, { width: 16 }, false).issue).toBeTruthy();
  });
});
