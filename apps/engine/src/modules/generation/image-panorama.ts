import sharp from 'sharp';

/** 只校正窄带色差，不尝试修复接缝两侧的结构错位。 */
export async function blendPanoramaSeam(input: Buffer) {
  const { data, info } = await sharp(input)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  if (Math.abs(width / height / 2 - 1) > 0.01 + Number.EPSILON)
    return { image: input, message: '输出不是 2:1，不能作为全景查看' };
  const original = Buffer.from(data);
  const band = Math.min(Math.floor(width / 2), Math.max(8, Math.round(width * 0.02)));
  const columns = Math.min(3, band);
  const differences = Array.from({ length: height }, (_, y) =>
    [0, 1, 2].map((c) => {
      let delta = 0;
      for (let x = 0; x < columns; x++)
        delta +=
          original[(y * width + x) * channels + c] -
          original[(y * width + width - 1 - x) * channels + c];
      return delta / columns;
    }),
  );
  for (let y = 0; y < height; y++) {
    const rows = differences.slice(Math.max(0, y - 4), Math.min(height, y + 5));
    for (let c = 0; c < 3; c++) {
      const delta = rows.reduce((sum, row) => sum + row[c], 0) / rows.length;
      for (let x = 0; x < band; x++) {
        const correction = (delta / 2) * (1 - x / band);
        for (const [column, sign] of [
          [x, -1],
          [width - 1 - x, 1],
        ]) {
          const index = (y * width + column) * channels + c;
          data[index] = Math.round(Math.max(0, Math.min(255, original[index] + sign * correction)));
        }
      }
    }
  }
  const edgeDifference = (pixels: Buffer) => {
    let total = 0;
    for (let y = 0; y < height; y++)
      for (let c = 0; c < 3; c++)
        total += Math.abs(
          pixels[y * width * channels + c] - pixels[(y * width + width - 1) * channels + c],
        );
    return total / (height * 3);
  };
  return {
    image: await sharp(data, { raw: info }).png().toBuffer(),
    message: `全景接缝颜色校正：边缘差值 ${edgeDifference(original).toFixed(2)} → ${edgeDifference(data).toFixed(2)}；结构错位需重新生成`,
  };
}
