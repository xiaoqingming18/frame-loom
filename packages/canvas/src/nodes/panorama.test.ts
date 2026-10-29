import { expect, it } from 'vitest';
import {
  isPanorama,
  panoramaCaptureSize,
  panoramaDirection,
  panoramaResolutionHint,
} from './panorama';

it('全景比例边界与无效尺寸', () => {
  for (const width of [198, 200, 202]) expect(isPanorama(width, 100)).toBe(true);
  for (const width of [197, 203, 0, -200, Infinity, NaN])
    expect(isPanorama(width, 100)).toBe(false);
  expect(isPanorama(undefined, 100)).toBe(false);
  expect(isPanorama(200, 0)).toBe(false);
});
it('四向朝向与俯仰限制', () => {
  const expected = [
    [1, 0],
    [0, 1],
    [-1, 0],
    [0, -1],
  ];
  for (const [index, yaw] of [0, 90, 180, 270].entries()) {
    const direction = panoramaDirection(yaw, 0);
    expect(direction.x).toBeCloseTo(expected[index][0]);
    expect(direction.z).toBeCloseTo(expected[index][1]);
  }
  expect(panoramaDirection(0, 90)).toEqual(panoramaDirection(0, 85));
  expect(panoramaDirection(0, -90)).toEqual(panoramaDirection(0, -85));
});
it('截图长边 1536，按角分辨率提示', () => {
  expect(panoramaCaptureSize('16:9')).toEqual({ width: 1536, height: 864 });
  expect(panoramaCaptureSize('9:16')).toEqual({ width: 864, height: 1536 });
  expect(panoramaCaptureSize('4:3')).toEqual({ width: 1536, height: 1152 });
  expect(() => panoramaCaptureSize('2:1')).toThrow();
  expect(panoramaResolutionHint(2880, 1536, 864, 75)).toContain('偏软');
  expect(panoramaResolutionHint(16000, 1536, 864, 75)).toContain('足够');
});
