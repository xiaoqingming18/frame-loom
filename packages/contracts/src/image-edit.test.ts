import { describe, expect, it } from 'vitest';
import {
  ImageEditRecipe,
  imageEditCapabilityIssue,
  type ImageEditCapabilities,
} from './image-edit.js';

const source = { nodeId: 'source-1', sha256: 'a'.repeat(64) };
const capabilities: ImageEditCapabilities = {
  operations: ['angle', 'lighting', 'emotion'],
  maxReferenceImages: 3,
  openAiImageEdit: true,
  mask: true,
};
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
    expect(imageEditCapabilityIssue(recipe, capabilities)).toBeUndefined();
    expect(imageEditCapabilityIssue(recipe, { ...capabilities, mask: false })).toBe(
      '所选模型不支持蒙版',
    );
    expect(
      imageEditCapabilityIssue(
        ImageEditRecipe.parse({
          ...emotion,
          maskMode: 'local',
          artifacts: { crop: 'b'.repeat(64), identity: 'c'.repeat(64) },
        }),
        { ...capabilities, maxReferenceImages: 2, mask: false },
      ),
    ).toBeUndefined();
    expect(imageEditCapabilityIssue(recipe, { ...capabilities, openAiImageEdit: false })).toBe(
      '表情编辑需要 OpenAI Images 编辑协议',
    );
  });
});
