export function isPanorama(width?: number | null, height?: number | null) {
  return (
    !!width &&
    !!height &&
    Number.isFinite(width) &&
    Number.isFinite(height) &&
    width > 0 &&
    height > 0 &&
    Math.abs(width / height / 2 - 1) <= 0.01 + Number.EPSILON
  );
}

export function panoramaDirection(yaw: number, pitch: number) {
  const longitude = (yaw * Math.PI) / 180;
  const latitude = (Math.max(-85, Math.min(85, pitch)) * Math.PI) / 180;
  // ERP 中央为正前方（+X），与 three 的等距柱状背景采样方向一致。
  return {
    x: Math.cos(latitude) * Math.cos(longitude),
    y: Math.sin(latitude),
    z: Math.cos(latitude) * Math.sin(longitude),
  };
}

export const panoramaRatios = ['16:9', '9:16', '4:3', '3:4', '1:1'] as const;
export function panoramaCaptureSize(ratio: string) {
  if (!panoramaRatios.some((item) => item === ratio)) throw new Error('不支持的截图比例');
  const [w, h] = ratio.split(':').map(Number);
  return {
    width: Math.round((1536 * w) / Math.max(w, h)),
    height: Math.round((1536 * h) / Math.max(w, h)),
  };
}

export function panoramaResolutionHint(
  sourceWidth: number,
  width: number,
  height: number,
  fov: number,
) {
  const horizontalFov =
    (2 * Math.atan((Math.tan((fov * Math.PI) / 360) * width) / height) * 180) / Math.PI;
  return (sourceWidth / 360) * horizontalFov < width
    ? '截取视角的像素高于源图角分辨率，画面可能偏软；可生成更清晰的全景。'
    : '源图角分辨率足够当前截图尺寸。';
}
