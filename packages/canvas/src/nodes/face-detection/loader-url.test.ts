import { expect, it } from 'vitest';
import { loaderUrl } from './loader-url';

it.each([
  [
    '/mediapipe/loader.js',
    'http://127.0.0.1:5173/src/worker.ts',
    'http://127.0.0.1:5173/mediapipe/loader.js',
  ],
  [
    '/mediapipe/loader.js?import&v=1',
    'app://frame-loom/assets/worker.js',
    'app://frame-loom/mediapipe/loader.js',
  ],
  [
    'http://127.0.0.1:5173/mediapipe/loader.js',
    'http://127.0.0.1:5173/worker.ts',
    'http://127.0.0.1:5173/mediapipe/loader.js',
  ],
  [
    'app://frame-loom/mediapipe/loader.js',
    'app://frame-loom/assets/worker.js',
    'app://frame-loom/mediapipe/loader.js',
  ],
])('loader 地址 %s 保留完整同源目标', (path, worker, expected) => {
  expect(loaderUrl(path, worker)).toBe(expected);
});
