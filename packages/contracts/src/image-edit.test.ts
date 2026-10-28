import { describe, expect, it } from 'vitest';
import {
  ImageEditRecipe,
  imageEditCapabilityIssue,
  type ImageEditCapabilities,
} from './image-edit.js';
import type { ModelProfile } from './generation.js';

const source = { nodeId: 'source-1', sha256: 'a'.repeat(64) };
const capabilities: ImageEditCapabilities = {
  operations: ['angle', 'lighting', 'emotion'],
  maxReferenceImages: 3,
  openAiImageEdit: true,
  mask: true,
};
const profile = (
  imageEditCapabilities = capabilities,
): Pick<ModelProfile, 'kind' | 'protocol' | 'modes' | 'inputs' | 'imageEditCapabilities'> => ({
  kind: 'image',
  protocol: 'openai-images',
  modes: [{ id: 'reference', name: '参考图' }],
  inputs: [
    { kind: 'image', transport: 'inline', maxCount: 3, maxBytes: 1000, mimeTypes: ['image/png'] },
  ],
  imageEditCapabilities,
});
const emotion = {
  version: 1 as const,
  source,
  operation: 'emotion' as const,
  targetFace: { x: 10, y: 10, width: 50, height: 60 },
  editRegion: { x: 0, y: 0, width: 80, height: 90 },
  imageWidth: 200,
  imageHeight: 150,
  presetId: 'neutral',
  intimacy: 0,
  arousal: 0,
  characterName: '角色1',
  maskMode: 'provider' as const,
  artifacts: { crop: 'b'.repeat(64), identity: 'c'.repeat(64), mask: 'd'.repeat(64) },
};

describe('ImageEditRecipe', () => {
  it('accepts bounded edits and rejects unknown fields and invalid geometry', () => {
    expect(ImageEditRecipe.parse(emotion)).toMatchObject({ postProcess: 'pending' });
    expect(() => ImageEditRecipe.parse({ ...emotion, extra: true })).toThrow();
    expect(() =>
      ImageEditRecipe.parse({ ...emotion, targetFace: { ...emotion.targetFace, x: -1 } }),
    ).toThrow();
    expect(() => ImageEditRecipe.parse({ ...emotion, imageWidth: 20000 })).toThrow();
  });

  it('shares model capability decisions with renderer and engine callers', () => {
    const recipe = ImageEditRecipe.parse(emotion);
    expect(imageEditCapabilityIssue(recipe, profile())).toBeUndefined();
    expect(imageEditCapabilityIssue(recipe, profile({ ...capabilities, mask: false }))).toBe(
      '所选模型不支持蒙版',
    );
    expect(
      imageEditCapabilityIssue(
        ImageEditRecipe.parse({
          ...emotion,
          maskMode: 'local',
          artifacts: { crop: 'b'.repeat(64), identity: 'c'.repeat(64) },
        }),
        profile({ ...capabilities, maxReferenceImages: 2, mask: false }),
      ),
    ).toBeUndefined();
    expect(
      imageEditCapabilityIssue(recipe, profile({ ...capabilities, openAiImageEdit: false })),
    ).toBe('表情编辑需要 OpenAI Images 编辑协议');
  });

  it.each(['angle', 'lighting'] as const)(
    '%s 只要求有效单参考输入，保留禁用与未知提示',
    (operation) => {
      const recipe = ImageEditRecipe.parse(
        operation === 'angle'
          ? {
              version: 1,
              source,
              operation,
              horizontalAngle: 0,
              pitchAngle: 0,
              cameraDistance: 5,
              lens: 'standard',
            }
          : {
              version: 1,
              source,
              operation,
              azimuth: 0,
              elevation: 0,
              brightness: 50,
              rimLight: false,
              stylePreset: '',
              smartMode: true,
              lightColor: '#ffffff',
            },
      );
      for (const protocol of ['openai-images', 'gemini-image', 'ark-images'] as const) {
        expect(
          imageEditCapabilityIssue(recipe, {
            ...profile({ ...capabilities, openAiImageEdit: false, mask: false }),
            protocol,
          }),
        ).toBeUndefined();
      }
      expect(
        imageEditCapabilityIssue(recipe, { ...profile(), imageEditCapabilities: undefined }),
      ).toContain('尚未确认');
      expect(
        imageEditCapabilityIssue(recipe, profile({ ...capabilities, operations: [] })),
      ).toContain('已禁用');
      expect(imageEditCapabilityIssue(recipe, { ...profile(), modes: [] })).toContain('参考图模式');
      expect(imageEditCapabilityIssue(recipe, { ...profile(), inputs: [] })).toContain('至少 1');
      expect(
        imageEditCapabilityIssue(recipe, { ...profile(), protocol: 'openai-videos' }),
      ).toContain('协议');
    },
  );

  it('表情在工件生成前也检查两图／三图及真实协议边界', () => {
    const recipe = ImageEditRecipe.parse({ ...emotion, artifacts: undefined });
    if (recipe.operation !== 'emotion') throw new Error('表情夹具无效');
    expect(imageEditCapabilityIssue(recipe, { ...profile(), protocol: 'gemini-image' })).toContain(
      'OpenAI Images',
    );
    expect(
      imageEditCapabilityIssue(recipe, profile({ ...capabilities, maxReferenceImages: 2 })),
    ).toContain('至少 3');
    expect(
      imageEditCapabilityIssue(
        { ...recipe, maskMode: 'local' },
        profile({ ...capabilities, maxReferenceImages: 1 }),
      ),
    ).toContain('至少 2');
    expect(
      imageEditCapabilityIssue(recipe, {
        ...profile(),
        inputs: [{ ...profile().inputs[0], maxCount: 1 }],
      }),
    ).toContain('至少 3');
  });
});
