export type CanvasFaceBox = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  confidence?: number;
  source: 'detected' | 'manual';
};

export type CanvasEmotionEditRegion = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type CanvasEmotionPreset = {
  id: string;
  label: string;
  intimacy: -2 | -1 | 0 | 1 | 2;
  arousal: -2 | -1 | 0 | 1 | 2;
  prompt: string;
};

export type CanvasEmotionParams = {
  presetId: string;
  intimacy: number;
  arousal: number;
  characterName: string;
  faceBox: CanvasFaceBox;
};

export type CanvasEmotionEditMode = 'provider-mask' | 'local-composite';

export type CanvasEmotionEditPlan = {
  mode: CanvasEmotionEditMode;
  includeMask: boolean;
  notice?: string;
};

export function resolveEmotionEditPlan(maskSupported: boolean): CanvasEmotionEditPlan {
  return maskSupported
    ? { mode: 'provider-mask', includeMask: true }
    : {
        mode: 'local-composite',
        includeMask: false,
        notice: '当前渠道不支持蒙版，使用脸部裁切与本地羽化融合',
      };
}

export function emotionPresetAt(intimacy: number, arousal: number): CanvasEmotionPreset {
  return (
    canvasEmotionPresets.find(
      (preset) => preset.intimacy === intimacy && preset.arousal === arousal,
    ) ?? neutralEmotionPreset
  );
}

export function emotionProviderMask<T>(plan: CanvasEmotionEditPlan, mask: T) {
  return plan.includeMask ? mask : undefined;
}

type BlendshapeName =
  | 'browInnerUp'
  | 'browDown_L'
  | 'browDown_R'
  | 'browOuterUp_L'
  | 'browOuterUp_R'
  | 'eyeBlink_L'
  | 'eyeBlink_R'
  | 'eyeSquint_L'
  | 'eyeSquint_R'
  | 'eyeWide_L'
  | 'eyeWide_R'
  | 'cheekSquint_L'
  | 'cheekSquint_R'
  | 'noseSneer_L'
  | 'noseSneer_R'
  | 'jawOpen'
  | 'mouthPucker'
  | 'mouthClose'
  | 'mouthSmile_L'
  | 'mouthSmile_R'
  | 'mouthFrown_L'
  | 'mouthFrown_R'
  | 'mouthDimple_L'
  | 'mouthDimple_R'
  | 'mouthShrugUpper'
  | 'mouthPress_L'
  | 'mouthPress_R'
  | 'mouthStretch_L'
  | 'mouthStretch_R';

export type CanvasEmotionBlendshapes = Partial<Record<BlendshapeName, number>>;

const labels = [
  ['欣喜若狂', '兴高采烈', '惊喜', '震惊', '惊恐'],
  ['开怀', '期待', '专注', '警觉', '紧张'],
  ['温柔', '浅然莞尔', '中性克制', '隐忍', '疏离'],
  ['安心', '释然', '疲惫', '失落', '悲伤'],
  ['满足', '平静', '冷淡', '隐忍心伤', '绝望'],
] as const;

const prompts = [
  [
    '自然、明亮的露齿笑，嘴角对称上扬，脸颊自然抬起，眼角有轻微笑纹',
    '明显喜悦，笑意饱满',
    '意外惊喜，眼睛睁大并自然张嘴',
    '明显震惊，眉毛抬起，嘴部微张',
    '强烈惊恐，双眼睁大，面部紧绷',
  ],
  [
    '自然开怀，眼角带笑',
    '期待而兴奋，表情明亮',
    '高度专注，目光坚定',
    '保持警觉，眉眼略微收紧',
    '紧张不安，嘴唇轻抿',
  ],
  [
    '温柔亲近，轻微微笑',
    '克制而自然的浅笑',
    '完全中性、克制、放松',
    '压住情绪，表情略显僵硬',
    '疏离冷静，减少面部情绪',
  ],
  [
    '安心放松，柔和闭合嘴角',
    '如释重负，眉眼放松',
    '明显疲惫，眼睑下垂',
    '情绪低落，嘴角轻微下垂',
    '悲伤，内眉抬起，嘴角下垂',
  ],
  [
    '安静满足，轻微闭口笑',
    '平静松弛，呼吸感自然',
    '冷淡克制，目光平直',
    '强忍心伤，嘴唇压紧，眼神黯淡',
    '深度绝望，眉眼下沉，面部失去张力',
  ],
] as const;

export const canvasEmotionPresets: CanvasEmotionPreset[] = labels.flatMap((row, rowIndex) =>
  row.map((label, columnIndex) => {
    const intimacy = (2 - columnIndex) as CanvasEmotionPreset['intimacy'];
    const arousal = (2 - rowIndex) as CanvasEmotionPreset['arousal'];
    return {
      id: `emotion-${intimacy}-${arousal}`,
      label,
      intimacy,
      arousal,
      prompt: prompts[rowIndex][columnIndex],
    };
  }),
);

export const neutralEmotionPreset = canvasEmotionPresets.find(
  (preset) => preset.intimacy === 0 && preset.arousal === 0,
)!;

export function findEmotionPreset(intimacy: number, arousal: number) {
  const x = clampAxis(intimacy);
  const y = clampAxis(arousal);
  return (
    canvasEmotionPresets.find((preset) => preset.intimacy === x && preset.arousal === y) ||
    neutralEmotionPreset
  );
}

export function emotionBlendshapes(preset: CanvasEmotionPreset): CanvasEmotionBlendshapes {
  if (preset === neutralEmotionPreset || (preset.intimacy === 0 && preset.arousal === 0)) return {};
  const warmth = Math.max(0, preset.intimacy / 2);
  const distance = Math.max(0, -preset.intimacy / 2);
  const activation = Math.max(0, preset.arousal / 2);
  const calm = Math.max(0, -preset.arousal / 2);
  const surprise = Math.max(0, activation * (1 - Math.abs(preset.intimacy) / 3));
  const sadness = Math.max(0, calm * (0.35 + distance * 0.65));
  const smile = warmth * (0.24 + activation * 0.48 + calm * 0.12);
  const tension = distance * (0.16 + activation * 0.46 + calm * 0.22);
  const shapes: CanvasEmotionBlendshapes = {
    browInnerUp: clamp01(surprise * 0.58 + sadness * 0.42),
    browDown_L: clamp01(tension * 0.7),
    browDown_R: clamp01(tension * 0.7),
    browOuterUp_L: clamp01(activation * 0.22 + surprise * 0.32),
    browOuterUp_R: clamp01(activation * 0.22 + surprise * 0.32),
    eyeBlink_L: clamp01(calm * 0.28),
    eyeBlink_R: clamp01(calm * 0.28),
    eyeSquint_L: clamp01(smile * 0.34 + tension * 0.28),
    eyeSquint_R: clamp01(smile * 0.34 + tension * 0.28),
    eyeWide_L: clamp01(activation * (0.16 + surprise * 0.48 + distance * 0.18)),
    eyeWide_R: clamp01(activation * (0.16 + surprise * 0.48 + distance * 0.18)),
    cheekSquint_L: clamp01(smile * 0.42),
    cheekSquint_R: clamp01(smile * 0.42),
    noseSneer_L: clamp01(tension * activation * 0.35),
    noseSneer_R: clamp01(tension * activation * 0.35),
    jawOpen: clamp01(activation * (0.06 + surprise * 0.34)),
    mouthPucker: clamp01(distance * calm * 0.12),
    mouthClose: clamp01(calm * 0.18 + tension * 0.2),
    mouthSmile_L: clamp01(smile),
    mouthSmile_R: clamp01(smile),
    mouthFrown_L: clamp01(sadness * 0.54 + distance * calm * 0.14),
    mouthFrown_R: clamp01(sadness * 0.54 + distance * calm * 0.14),
    mouthDimple_L: clamp01(warmth * 0.22),
    mouthDimple_R: clamp01(warmth * 0.22),
    mouthShrugUpper: clamp01(sadness * 0.18),
    mouthPress_L: clamp01(tension * 0.48 + calm * distance * 0.18),
    mouthPress_R: clamp01(tension * 0.48 + calm * distance * 0.18),
    mouthStretch_L: clamp01(activation * distance * 0.24),
    mouthStretch_R: clamp01(activation * distance * 0.24),
  };
  return Object.fromEntries(
    Object.entries(shapes).filter(([, value]) => Boolean(value && value > 0.01)),
  );
}

export function clampAxis(value: number): CanvasEmotionPreset['intimacy'] {
  return Math.max(-2, Math.min(2, Math.round(value))) as CanvasEmotionPreset['intimacy'];
}

export function buildEmotionPrompt(
  params: CanvasEmotionParams,
  editRegion: CanvasEmotionEditRegion,
) {
  const preset =
    canvasEmotionPresets.find((item) => item.id === params.presetId) ||
    findEmotionPreset(params.intimacy, params.arousal);
  const targetRegion = describeEmotionTarget(params.faceBox, editRegion);
  return [
    `仅修改第一张输入图中“${params.characterName}”脸部的表情，其他像素保持源图一致。`,
    `目标情绪：${preset.label}；表情要求：${preset.prompt}。情绪强度通过眉眼、嘴角和脸颊的肌肉张力表达，不要通过夸大嘴巴或重绘整张脸表达。`,
    '第一张输入图是唯一编辑目标，第二张输入图仅用于核对同一人物身份，不得复制第二张图的构图、背景或光线。',
    targetRegion,
    '如果第一张输入图中出现其他人脸，其他人脸全部视为不可编辑背景；只允许修改目标人脸框及其邻近表情区域。',
    '只改变眉眼开合、眼角、嘴角、脸颊和口腔内部的表情细节；保持眼睛大小与方向、嘴裂宽度、牙齿数量大小排列、嘴唇厚度、下巴轮廓和脸型自然且与原图一致。',
    '输入图已裁切到目标人物头部区域；只重绘目标人脸及其表情相关细节，不要生成或修改裁切图中的其他内容。',
    '严格保持人物身份、五官比例、肤色、发型、发丝、耳朵、配饰、服装、姿势、头部朝向、镜头、景深、光线、背景及画面其他人物不变；不要重绘眼镜、帽子或遮挡物。',
    '禁止夸张卡通笑、嘴巴过大或拉宽、牙齿像整齐白墙、露出不自然牙龈、眼睛变形或眯成线、脸颊鼓包、塑料磨皮、重复五官，以及任何身份漂移。',
  ].join('\n');
}

function describeEmotionTarget(box: CanvasFaceBox, region: CanvasEmotionEditRegion) {
  const x = clamp(Math.round(box.x - region.x), 0, Math.max(0, region.width - 1));
  const y = clamp(Math.round(box.y - region.y), 0, Math.max(0, region.height - 1));
  const width = Math.max(1, Math.min(region.width - x, Math.round(box.width)));
  const height = Math.max(1, Math.min(region.height - y, Math.round(box.height)));
  const centerX = Math.round(((x + width / 2) / Math.max(1, region.width)) * 100);
  const centerY = Math.round(((y + height / 2) / Math.max(1, region.height)) * 100);
  return `目标人脸框（相对于第一张裁切输入图）：x=${x}px，y=${y}px，width=${width}px，height=${height}px；人脸中心约位于裁切图的 ${centerX}% 横向、${centerY}% 纵向。最终仅将该人脸周围的椭圆区域融合回原图。`;
}

export function clampFaceBox(
  box: CanvasFaceBox,
  imageWidth: number,
  imageHeight: number,
): CanvasFaceBox {
  const x = Math.max(0, Math.min(imageWidth - 1, box.x));
  const y = Math.max(0, Math.min(imageHeight - 1, box.y));
  return {
    ...box,
    x,
    y,
    width: Math.max(1, Math.min(imageWidth - x, box.width)),
    height: Math.max(1, Math.min(imageHeight - y, box.height)),
  };
}

export function resolveEditRegion(
  box: CanvasFaceBox,
  imageWidth: number,
  imageHeight: number,
): CanvasEmotionEditRegion {
  const left = Math.floor(Math.max(0, box.x - box.width * 0.85));
  const top = Math.floor(Math.max(0, box.y - box.height * 0.75));
  const right = Math.ceil(Math.min(imageWidth, box.x + box.width * 1.85));
  const bottom = Math.ceil(Math.min(imageHeight, box.y + box.height * 2));
  return { x: left, y: top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
