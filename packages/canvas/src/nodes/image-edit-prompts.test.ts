import { expect, it } from 'vitest';
import { ImageEditRecipe } from '@frame-loom/contracts';
import { buildImageEditPrompt } from './image-edit-prompts';
import { buildLightingPrompt, defaultLightingParameters } from './image-edit-parameters';
import { buildEmotionPrompt } from './image-emotion';

const source = { nodeId: 'source', sha256: 'a'.repeat(64) };
it('全景提示词固定投影、方位与禁止项，并追加环境描述', () => {
  expect(
    buildImageEditPrompt({ version: 1, operation: 'panorama', source, sceneHint: '四周为竹林' }),
  ).toBe(
    '将参考图转成严格 2:1 等距柱状投影（equirectangular）全景，水平 360°、垂直 180°。地平线位于画面纵向中线；以源图为正前方视角并放在画面中央。补全左右、后方、天空或天花板、地面或地板，左右边缘连续无缝。保持源图的风格、材质、光线和时代特征。禁止拼贴、分格、边框、文字、水印、拍摄设备。四周环境补充描述：四周为竹林',
  );
});
it('集中提示词保持角度、打光原文，表情坐标计入补边', () => {
  const angle = ImageEditRecipe.parse({
    version: 1,
    source,
    operation: 'angle',
    horizontalAngle: 20,
    pitchAngle: -10,
    cameraDistance: 2,
    lens: 'wide',
  });
  expect(buildImageEditPrompt(angle)).toBe(
    '保持主体身份与风格一致，将视角调整为水平 20°、俯仰 -10°，景别 2.0，广角镜头。',
  );
  const lighting = ImageEditRecipe.parse({
    version: 1,
    source,
    operation: 'lighting',
    ...defaultLightingParameters,
  });
  expect(buildImageEditPrompt(lighting)).toBe(buildLightingPrompt(defaultLightingParameters));
  expect(buildImageEditPrompt(lighting, '晨光', '{{smartDesc}}')).toBe(
    buildLightingPrompt(defaultLightingParameters, '晨光', '{{smartDesc}}'),
  );
  const emotion = ImageEditRecipe.parse({
    version: 1,
    source,
    operation: 'emotion',
    targetFace: { x: 20, y: 30, width: 40, height: 50 },
    editRegion: { x: 0, y: 0, width: 80, height: 100 },
    imageWidth: 80,
    imageHeight: 100,
    presetId: 'neutral',
    intimacy: 0,
    arousal: 0,
    characterName: '角色1',
    maskMode: 'local',
  });
  if (emotion.operation !== 'emotion') throw new Error('夹具无效');
  expect(buildImageEditPrompt(emotion)).toBe(
    buildEmotionPrompt(
      { ...emotion, faceBox: { ...emotion.targetFace, id: 'target', source: 'manual' } },
      emotion.editRegion,
    ),
  );
  emotion.geometry = {
    crop: emotion.editRegion,
    pad: { left: 10, right: 10, top: 0, bottom: 0 },
    expected: { ratio: 1 },
  };
  expect(buildImageEditPrompt(emotion)).toContain('x=30px，y=30px');
});
