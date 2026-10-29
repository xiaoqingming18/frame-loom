import type { ImageEditRecipe } from '@frame-loom/contracts';
import { buildEmotionPrompt } from './image-emotion';
import { buildLightingPrompt } from './image-edit-parameters';

export function buildImageEditPrompt(
  recipe: ImageEditRecipe,
  smartDescription = '',
  template?: string,
) {
  if (recipe.operation === 'panorama')
    return `将参考图转成严格 2:1 等距柱状投影（equirectangular）全景，水平 360°、垂直 180°。地平线位于画面纵向中线；以源图为正前方视角并放在画面中央。补全左右、后方、天空或天花板、地面或地板，左右边缘连续无缝。保持源图的风格、材质、光线和时代特征。禁止拼贴、分格、边框、文字、水印、拍摄设备。${recipe.sceneHint ? `四周环境补充描述：${recipe.sceneHint}` : ''}`;
  if (recipe.operation === 'angle')
    return `保持主体身份与风格一致，将视角调整为水平 ${recipe.horizontalAngle}°、俯仰 ${recipe.pitchAngle}°，景别 ${recipe.cameraDistance.toFixed(1)}，${recipe.lens === 'wide' ? '广角' : '标准'}镜头。`;
  if (recipe.operation === 'lighting')
    return buildLightingPrompt(recipe, smartDescription, template);
  const pad = recipe.geometry?.pad;
  const region = recipe.geometry?.crop ?? recipe.editRegion;
  return buildEmotionPrompt(
    { ...recipe, faceBox: { ...recipe.targetFace, id: 'target', source: 'manual' } },
    {
      x: region.x - (pad?.left ?? 0),
      y: region.y - (pad?.top ?? 0),
      width: region.width + (pad?.left ?? 0) + (pad?.right ?? 0),
      height: region.height + (pad?.top ?? 0) + (pad?.bottom ?? 0),
    },
  );
}
