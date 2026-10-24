import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

const env = {
  FRAME_LOOM_TOKEN: 'a'.repeat(64),
  FRAME_LOOM_DATA_DIR: resolve('test-data'),
};

describe('环境配置', () => {
  it('接受绝对目录和大小写十六进制令牌，默认不放行浏览器源', () => {
    expect(loadConfig({ ...env, FRAME_LOOM_TOKEN: 'AB01'.repeat(16) }))
      .toMatchObject({ token: 'AB01'.repeat(16), dataDir: env.FRAME_LOOM_DATA_DIR, allowedOrigins: [] });
  });

  it('接受开发服务器与打包应用的完整源', () => {
    const allowedOrigins = ['http://localhost:5173', 'http://127.0.0.1:5173', 'https://localhost', 'app://frame-loom'];
    expect(loadConfig({ ...env, FRAME_LOOM_ALLOWED_ORIGINS: JSON.stringify(allowedOrigins) }).allowedOrigins)
      .toEqual(allowedOrigins);
  });

  it.each([undefined, '', 'a'.repeat(63), 'a'.repeat(65), 'z'.repeat(64), `${'a'.repeat(64)}\n`])(
    '拒绝无效令牌（%s）', (token) => {
      expect(() => loadConfig({ ...env, FRAME_LOOM_TOKEN: token })).toThrow(/FRAME_LOOM_TOKEN/);
    },
  );

  it.each([undefined, '', './data', 'relative/data'])('拒绝非绝对目录（%s）', (dataDir) => {
    expect(() => loadConfig({ ...env, FRAME_LOOM_DATA_DIR: dataDir })).toThrow(/数据目录/);
  });

  it.each(['*', '[', 'null', '{}', '[1]', '["*"]', '["null"]', '["file://app"]',
    '["http://user:pass@localhost"]', '["http://localhost/path"]', '["http://localhost/"]',
    '["http://localhost?query"]', '["http://localhost#hash"]', '["app:"]'])('拒绝无效允许源（%s）', (origins) => {
    expect(() => loadConfig({ ...env, FRAME_LOOM_ALLOWED_ORIGINS: origins })).toThrow(/engine 配置无效/);
  });
});
