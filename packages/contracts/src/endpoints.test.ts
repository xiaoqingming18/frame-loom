import { describe, expect, it } from 'vitest';
import { fillEndpoint, resolveCatalogUrl, resolveEndpoints } from './endpoints.js';
import { getProtocol } from './protocols.js';

function resolve(
  baseUrl: string,
  id: string,
  override = {},
  upstreamModelId = 'gemini-3.8-flash-tts',
) {
  return resolveEndpoints(
    { baseUrl },
    { upstreamModelId, endpointOverride: { confirmedHosts: [], ...override } },
    getProtocol(id)!,
  );
}
describe('统一地址解析', () => {
  it.each([
    ['https://liuguang.ai/v1', 'openai-responses', {}, 'https://liuguang.ai/v1/responses'],
    [
      'https://liuguang.ai/v1',
      'gemini-generate',
      {},
      'https://liuguang.ai/v1beta/models/gemini-3.8-flash-tts:generateContent',
    ],
    [
      'https://liuguang.ai/v1',
      'minimax-video-v2',
      { submitUrl: 'https://liuguang.ai/minimax/v2/video_generation' },
      'https://liuguang.ai/minimax/v2/video_generation',
    ],
    [
      'https://api.minimax.io',
      'minimax-video-v2',
      {},
      'https://api.minimax.io/v2/video_generation',
    ],
    [
      'https://x.ai/gateway/v1',
      'gemini-generate',
      {},
      'https://x.ai/gateway/v1beta/models/gemini-3.8-flash-tts:generateContent',
    ],
  ])('地址示例 %s %s', (base, id, override, expected) => {
    const result = resolve(base, id, override);
    expect(result.operations.submit?.url).toBe(expected);
    expect(result.issues).toEqual([]);
  });
  it('覆盖提交地址推导查询，操作覆盖优先，失败时要求填写缺失操作', () => {
    expect(
      resolve('https://a.test/v1', 'minimax-video-v2', {
        submitUrl: 'https://a.test/minimax/v2/video_generation',
      }).operations.query?.url,
    ).toBe('https://a.test/minimax/v2/query/video_generation/{id}');
    const result = resolve('https://a.test/v1', 'minimax-video-v2', {
      submitUrl: 'https://ignored.test/other',
      operations: {
        submit: 'https://b.test/proxy/v2/video_generation',
        query: 'https://c.test/query?id={id}',
      },
    });
    expect(result.foreignHosts).toEqual(['b.test', 'c.test']);
    expect(result.operations.query).toMatchObject({
      template: true,
      url: 'https://c.test/query?id={id}',
    });
    const failed = resolve('https://a.test', 'minimax-video-v2', {
      submitUrl: 'https://a.test/custom',
    });
    expect(failed.issues).toHaveLength(1);
    expect(failed.operations.query).toBeUndefined();
  });
  it('模型占位段匹配，查询模板保持，跨主机去重', () => {
    const result = resolve('https://a.test/v1', 'kling-omni', {
      submitUrl: 'https://B.test/proxy/omni-video/some-model',
    });
    expect(result.operations.query?.url).toBe('https://B.test/proxy/tasks?task_ids={id}');
    expect(result.foreignHosts).toEqual(['b.test']);
    expect(
      resolve('https://a.test', 'gemini-generate', {}, 'a b:1').operations.submit?.url,
    ).toContain('a%20b%3A1:generateContent');
  });
  it.each(['.', '..', 'a/b', 'a\\b'])('拒绝路径逃逸 %s', (value) =>
    expect(() => fillEndpoint('https://a.test/{id}', { id: value })).toThrow(),
  );
  it('替换参数逐段编码，保留未填占位符', () =>
    expect(fillEndpoint('https://a.test/{id}/{voice_id}', { id: 'a b?x=1' })).toBe(
      'https://a.test/a%20b%3Fx%3D1/{voice_id}',
    ));
  it.each(['openai', 'anthropic', 'gemini'] as const)('列表格式 %s', (format) => {
    expect(resolveCatalogUrl('https://a.test/gateway/v1/', format)).toBe(
      `https://a.test/gateway/${format === 'gemini' ? 'v1beta' : 'v1'}/models`,
    );
  });
});
