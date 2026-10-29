import { expect, it } from 'vitest';
import { planEditGeometry } from './edit-geometry.js';
import { getProtocol } from './protocols.js';
import { resolveImageSize } from './image-size.js';
import { ImageEditRecipe } from './image-edit.js';

it.each([0.75, 1.6, 0.2, 0.7, 1, 3, 8])('自定义像素规划遵守全部限制：%s', (aspect) => {
  const cap = structuredClone(getProtocol('openai-images')!.templates.image!);
  const plan = planEditGeometry(cap, {
    x: 0,
    y: 0,
    width: Math.round(1000 * aspect),
    height: 1000,
  });
  expect(resolveImageSize(cap, plan.request, true).issue).toBeUndefined();
  expect(plan.request.width! % 16).toBe(0);
  expect(
    Math.abs(
      (plan.crop.width + plan.pad.left + plan.pad.right) /
        (plan.crop.height + plan.pad.top + plan.pad.bottom) /
        plan.expected.ratio! -
        1,
    ),
  ).toBeLessThan(0.01);
});

it.each(['pixels', 'tier', 'ratio'] as const)('标准尺寸按最近比例补边：%s', (wire) => {
  const cap = structuredClone(getProtocol('openai-images')!.templates.image!);
  cap.size = {
    wire,
    default: { tier: '1K', ratio: '1:1' },
    tiers: [
      {
        name: '1K',
        enabled: true,
        ratios: [
          { ratio: '1:1', pixels: '1024x1024' },
          { ratio: '3:4', pixels: '768x1024' },
        ],
      },
    ],
  };
  const plan = planEditGeometry(cap, { x: 5, y: 10, width: 700, height: 1000 });
  expect(plan.request).toEqual({ tier: '1K', aspectRatio: '3:4' });
  expect(plan.pad).toEqual({ left: 25, right: 25, top: 0, bottom: 0 });
  cap.size.tiers[0].enabled = false;
  expect(() => planEditGeometry(cap, plan.crop)).toThrow('没有已启用');
});

it('none、auto 不发尺寸，无解与非法区域拒绝', () => {
  const cap = structuredClone(getProtocol('openai-images')!.templates.image!);
  const rect = { x: 0, y: 0, width: 700, height: 1000 };
  expect(planEditGeometry({ ...cap, size: { ...cap.size, wire: 'none' } }, rect).request).toEqual(
    {},
  );
  expect(
    planEditGeometry({ ...cap, size: { ...cap.size, default: { auto: true } } }, rect).expected,
  ).toEqual({});
  cap.size.custom = { maxEdge: 16, minPixels: 1000, multipleOf: 16 };
  expect(() => planEditGeometry(cap, rect)).toThrow('无可行解');
  expect(() => planEditGeometry(cap, { ...rect, x: -1 })).toThrow();
});

it('Gemini 模板为 0.7 源比例选择最近的 2:3 并补边', () => {
  const cap = structuredClone(getProtocol('gemini-generate')!.templates.image!);
  const plan = planEditGeometry(cap, { x: 0, y: 0, width: 700, height: 1000 });
  expect(plan.request.aspectRatio).toBe('2:3');
  expect(plan.pad).toEqual({ left: 0, right: 0, top: 25, bottom: 25 });
  for (const tier of cap.size.tiers) tier.enabled = false;
  expect(() => planEditGeometry(cap, plan.crop)).toThrow('没有已启用');
});

it('补边不能越过像素处理上限', () => {
  const cap = structuredClone(getProtocol('openai-images')!.templates.image!);
  cap.size = {
    wire: 'tier',
    tiers: [{ name: '1K', enabled: true, ratios: [{ ratio: '1000000:1' }] }],
    default: { tier: '1K', ratio: '1000000:1' },
  };
  expect(() => planEditGeometry(cap, { x: 0, y: 0, width: 100, height: 100 })).toThrow(
    '像素处理上限',
  );
});

it('新配方校验几何边界，旧配方仍兼容', () => {
  const recipe = {
    version: 1,
    operation: 'emotion',
    source: { nodeId: 'source', sha256: 'a'.repeat(64) },
    targetFace: { x: 0, y: 0, width: 10, height: 10 },
    editRegion: { x: 0, y: 0, width: 20, height: 20 },
    imageWidth: 30,
    imageHeight: 30,
    presetId: 'neutral',
    intimacy: 0,
    arousal: 0,
    characterName: '',
    maskMode: 'local',
  };
  expect(ImageEditRecipe.safeParse(recipe).success).toBe(true);
  expect(
    ImageEditRecipe.safeParse({
      ...recipe,
      geometry: {
        crop: { x: 20, y: 0, width: 20, height: 20 },
        pad: { left: 0, right: 0, top: 0, bottom: 0 },
        expected: {},
      },
    }).success,
  ).toBe(false);
});
