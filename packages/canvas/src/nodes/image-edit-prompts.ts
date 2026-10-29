import type { ImageEditRecipe } from '@frame-loom/contracts';
import { buildEmotionPrompt } from './image-emotion';
import { buildLightingPrompt } from './image-edit-parameters';

export function buildImageEditPrompt(
  recipe: ImageEditRecipe,
  smartDescription = '',
  template?: string,
) {
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
