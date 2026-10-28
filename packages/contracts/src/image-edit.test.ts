import { describe, expect, it } from 'vitest';
import { ImageEditRecipe, imageEditSupport } from './image-edit.js';
import { getProtocol } from './protocols.js';

const source = { nodeId: 'source-1', sha256: 'a'.repeat(64) };
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

  it('参考数与协议编辑能力共同决定工具可用性', () => {
    const protocol = getProtocol('openai-images')!;
    const cap = structuredClone(protocol.templates.image!);
    cap.references.max = 0;
    expect(imageEditSupport(cap, protocol).angle.available).toBe(false);
    cap.references.max = 1;
    expect(imageEditSupport(cap, protocol).angle.available).toBe(true);
    expect(imageEditSupport(cap, protocol).emotion.available).toBe(false);
    cap.references.max = 2;
    expect(imageEditSupport(cap, protocol).emotion.available).toBe(true);
    expect(imageEditSupport(cap, protocol).emotion.mask).toBe(false);
    cap.references.max = 3;
    expect(imageEditSupport(cap, protocol).emotion.mask).toBe(true);
  });
});
