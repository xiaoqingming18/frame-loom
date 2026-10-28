import { expect, it } from 'vitest';
import { ImageEditRecipe } from '@frame-loom/contracts';
import { canvasEmotionPresets, emotionPresetAt, neutralEmotionPreset } from './image-emotion';
import {
  applyAnglePreset,
  buildLightingPrompt,
  defaultAngleParameters,
  defaultLightingParameters,
} from './image-edit-parameters';

it('角度预设只更改水平与俯仰，景别和镜头保持用户选择', () => {
  expect(
    applyAnglePreset({ ...defaultAngleParameters, cameraDistance: 8, lens: 'wide' }, 'left'),
  ).toEqual({ horizontalAngle: -90, pitchAngle: 0, cameraDistance: 8, lens: 'wide' });
});

it('打光提示词映射方向、亮度、轮廓、颜色、风格和智能描述', () => {
  const prompt = buildLightingPrompt(
    {
      ...defaultLightingParameters,
      azimuth: 90,
      elevation: 25,
      brightness: 70,
      rimLight: true,
      stylePreset: 'rembrandt',
      lightColor: '#ffeecc',
    },
    '窗边柔光',
  );
  expect(prompt).toContain('伦勃朗');
  expect(prompt).toContain('窗边柔光');
  expect(prompt).toContain('90° 方位、25° 仰角');
  expect(prompt).toContain('亮度：70%');
  expect(prompt).toContain('轮廓光');
  expect(prompt).toContain('#ffeecc');
});

it('情绪盘的 25 个坐标唯一映射到预设，中心为中性', () => {
  expect(canvasEmotionPresets).toHaveLength(25);
  expect(new Set(canvasEmotionPresets.map((item) => `${item.intimacy}:${item.arousal}`)).size).toBe(
    25,
  );
  expect(emotionPresetAt(0, 0)).toBe(neutralEmotionPreset);
  expect(emotionPresetAt(8, -8)).toBe(neutralEmotionPreset);
  for (const preset of canvasEmotionPresets) {
    expect(
      ImageEditRecipe.safeParse({
        version: 1,
        source: { nodeId: 'source', sha256: 'a'.repeat(64) },
        operation: 'emotion',
        targetFace: { x: 0, y: 0, width: 10, height: 10 },
        editRegion: { x: 0, y: 0, width: 10, height: 10 },
        imageWidth: 10,
        imageHeight: 10,
        presetId: preset.id,
        intimacy: preset.intimacy,
        arousal: preset.arousal,
        characterName: '角色1',
        maskMode: 'local',
      }).success,
    ).toBe(true);
  }
});

it('模板即时替换变量并始终保留画面一致性约束', () => {
  const prompt = buildLightingPrompt(
    defaultLightingParameters,
    '窗边',
    '{{smartDesc}}, {{brightnessPrompt}}',
  );
  expect(prompt).toContain('窗边');
  expect(prompt).toContain('亮度：50%');
  expect(prompt).toContain('保持人物身份');
  expect(prompt).not.toContain('{{');
});
