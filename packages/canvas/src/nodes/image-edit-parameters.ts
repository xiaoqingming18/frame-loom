export const anglePresets = [
  { id: 'front', label: '正面', horizontalAngle: 0, pitchAngle: 0 },
  { id: 'left', label: '左侧', horizontalAngle: -90, pitchAngle: 0 },
  { id: 'right', label: '右侧', horizontalAngle: 90, pitchAngle: 0 },
  { id: 'back', label: '背面', horizontalAngle: 180, pitchAngle: 0 },
  { id: 'top', label: '俯拍', horizontalAngle: 0, pitchAngle: 60 },
  { id: 'bottom', label: '仰拍', horizontalAngle: 0, pitchAngle: -60 },
] as const;

export type AngleParameters = {
  horizontalAngle: number;
  pitchAngle: number;
  cameraDistance: number;
  lens: 'standard' | 'wide';
};

export const defaultAngleParameters: AngleParameters = {
  horizontalAngle: 45,
  pitchAngle: 0,
  cameraDistance: 4.8,
  lens: 'standard',
};

export function applyAnglePreset(current: AngleParameters, presetId: string): AngleParameters {
  const preset = anglePresets.find((item) => item.id === presetId);
  return preset
    ? { ...current, horizontalAngle: preset.horizontalAngle, pitchAngle: preset.pitchAngle }
    : current;
}

export type LightingParameters = {
  azimuth: number;
  elevation: number;
  brightness: number;
  rimLight: boolean;
  stylePreset: string;
  smartMode: boolean;
  lightColor: string;
};

export const defaultLightingParameters: LightingParameters = {
  azimuth: 0,
  elevation: 0,
  brightness: 50,
  rimLight: false,
  stylePreset: '',
  smartMode: true,
  lightColor: '#ffffff',
};

export const lightingStylePrompts = {
  overexposed: '高调过曝胶片光，柔和扩散，高光略微洗白',
  blueBacklight: '蓝色戏剧逆光，冷色轮廓边缘光',
  rembrandt: '伦勃朗 45 度主光，明暗对照，古典人像',
  cyberpunk: '赛博朋克霓虹灯，青色与洋红色辉光',
  sunset: '温暖日落光，长阴影，浪漫氛围',
  mysterious: '低调 noir 灯光，深阴影，高反差',
  goldenHour: '黄金时刻暖光，柔和高光与自然光晕',
  nolanGrey: '冷灰电影调色，低饱和，青灰色调',
} as const;

export const defaultLightingTemplate =
  '{{consistencyPrompt}}, {{presetPrompt}}, {{smartDesc}}, {{lightDirectionPrompt}}, {{brightnessPrompt}}, {{rimLightPrompt}}, {{lightColorPrompt}}, {{lightingMeta}}';

export function buildLightingPrompt(
  options: LightingParameters,
  smartDescription = '',
  template = defaultLightingTemplate,
) {
  const direction = `${options.azimuth}° 方位、${options.elevation}° 仰角`;
  const values: Record<string, string> = {
    consistencyPrompt:
      '保持人物身份、人数、构图、姿势、服装、背景与其他画面内容一致，只重新布置光照。描述的是光照而不是实体灯具，不要在画面中增加灯具、反光板或摄影设备。',
    presetPrompt: options.stylePreset
      ? (lightingStylePrompts[options.stylePreset as keyof typeof lightingStylePrompts] ?? '')
      : '',
    smartDesc: options.smartMode ? smartDescription.trim() : '',
    lightDirectionPrompt: `主光方向：${direction}`,
    brightnessPrompt: `亮度：${options.brightness}%`,
    rimLightPrompt: options.rimLight ? '加入轮廓光' : '',
    lightColorPrompt:
      options.lightColor.toLowerCase() === '#ffffff' ? '' : `光色：${options.lightColor}`,
    lightingMeta: `[lighting azimuth:${options.azimuth}° elevation:${options.elevation}° brightness:${options.brightness}%${options.rimLight ? ' rim:on' : ''}]`,
  };
  const effective = template.includes('{{consistencyPrompt}}')
    ? template
    : `{{consistencyPrompt}}, ${template}`;
  return effective
    .replace(/\{\{(\w+)\}\}/g, (_match, key: string) => values[key] ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .join(', ');
}
