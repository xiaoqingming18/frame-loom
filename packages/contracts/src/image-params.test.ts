import { describe, expect, it } from 'vitest';
import {
  checkGenerationRequest,
  GenerationRequest,
  ModelProfile,
  DEFAULT_IMAGE_PARAMS,
  IMAGE_ASPECT_RATIOS,
  IMAGE_RESOLUTIONS,
  IMAGE_QUALITIES,
  IMAGE_BACKGROUNDS,
  IMAGE_PARAM_LABELS,
  IMAGE_QUALITY_LABELS,
  IMAGE_BACKGROUND_LABELS,
  imageRequestSize,
  resolveImageParams,
} from './index.js';

function profile(
  protocol: ModelProfile['protocol'] = 'openai-images',
  resolutions: readonly string[] = IMAGE_RESOLUTIONS,
): ModelProfile {
  return ModelProfile.parse({
    id: 'test',
    name: '测试图片',
    kind: 'image',
    protocol,
    matchIds: [],
    generic: false,
    modes: [{ id: 'text', name: '文生图' }],
    params: [
      {
        key: 'aspectRatio',
        name: '比例',
        type: 'enum',
        values: IMAGE_ASPECT_RATIOS,
        default: '1:1',
      },
      ...(resolutions.length
        ? [
            {
              key: 'resolution',
              name: '清晰度',
              type: 'enum',
              values: resolutions,
              default: resolutions.includes('2K') ? '2K' : resolutions[0],
              notes: { '4K': '实验' },
            },
          ]
        : []),
      { key: 'quality', name: '画质', type: 'enum', values: IMAGE_QUALITIES, default: 'medium' },
      { key: 'background', name: '背景', type: 'enum', values: IMAGE_BACKGROUNDS, default: 'auto' },
    ],
    constraints: [],
    inputs: [],
    runtime: {
      concurrency: 1,
      pollInitialMs: 100,
      pollMaxMs: 1000,
      timeoutMs: 10000,
      submitTimeoutMs: 1000,
      supportsCancel: false,
    },
  });
}

describe('图片尺寸换算', () => {
  it.each(IMAGE_RESOLUTIONS)('OpenAI %s 的 14 比例满足全部尺寸约束和比例误差', (resolution) => {
    for (const aspectRatio of IMAGE_ASPECT_RATIOS) {
      const size = imageRequestSize(profile(), { aspectRatio, resolution })!;
      const [w, h] = size.split('x').map(Number);
      const [rw, rh] = aspectRatio.split(':').map(Number);
      expect(w % 16).toBe(0);
      expect(h % 16).toBe(0);
      expect(Math.max(w, h)).toBeLessThanOrEqual(3840);
      expect(Math.max(w, h) / Math.min(w, h)).toBeLessThanOrEqual(3);
      expect(w * h).toBeGreaterThanOrEqual(655_360);
      expect(w * h).toBeLessThanOrEqual(8_294_400);
      expect(Math.abs(w / h / (rw / rh) - 1)).toBeLessThan(0.01);
    }
  });
  it.each([
    ['1:1', '1024x1024', '1920x1920', '2880x2880'],
    ['16:9', '1360x768', '2560x1440', '3840x2160'],
    ['21:9', '1568x672', '2928x1264', '3840x1648'],
    ['3:1', '1776x592', '3312x1104', '3840x1280'],
  ])('OpenAI %s 与方案示例一致', (aspectRatio, ...sizes) => {
    expect(
      IMAGE_RESOLUTIONS.map((resolution) =>
        imageRequestSize(profile(), { aspectRatio, resolution }),
      ),
    ).toEqual(sizes);
  });
  it('GPT Image 1 固定表与 Gemini 不换算', () => {
    const fixed = profile('openai-images', []);
    fixed.params[0].values = ['1:1', '3:2', '2:3'];
    expect(
      ['1:1', '3:2', '2:3'].map((aspectRatio) => imageRequestSize(fixed, { aspectRatio })),
    ).toEqual(['1024x1024', '1536x1024', '1024x1536']);
    expect(imageRequestSize(fixed, { aspectRatio: '21:9' })).toBe('1536x1024');
    expect(imageRequestSize(profile('gemini-image'), {})).toBeUndefined();
    expect(imageRequestSize(profile(), {})).toBe('1920x1920');
    expect(() => imageRequestSize({ ...fixed, kind: 'video' }, {})).toThrow('图片档案');
    expect(() => imageRequestSize({ ...fixed, params: [] }, {})).toThrow('有效比例');
  });
  it.each([
    ['1:1', '1024x1024', '2048x2048', '4096x4096'],
    ['4:3', '1152x864', '2304x1728', '4704x3520'],
    ['3:4', '864x1152', '1728x2304', '3520x4704'],
    ['16:9', '1280x720', '2848x1600', '5504x3040'],
    ['9:16', '720x1280', '1600x2848', '3040x5504'],
    ['3:2', '1248x832', '2496x1664', '4992x3328'],
    ['2:3', '832x1248', '1664x2496', '3328x4992'],
    ['21:9', '1512x648', '3136x1344', '6240x2656'],
  ])('Seedream %s 的三档与官方表逐项相等', (aspectRatio, ...sizes) => {
    expect(
      IMAGE_RESOLUTIONS.map((resolution) =>
        imageRequestSize(profile('ark-images'), { aspectRatio, resolution }),
      ),
    ).toEqual(sizes);
  });
  it.each([
    ['4.0', IMAGE_RESOLUTIONS, 921_600],
    ['4.5', ['2K', '4K'], 3_686_400],
  ] as const)('Seedream %s 所有比例与档位均在合法范围', (_version, resolutions, min) => {
    for (const resolution of resolutions)
      for (const aspectRatio of IMAGE_ASPECT_RATIOS) {
        const [w, h] = imageRequestSize(profile('ark-images', resolutions), {
          aspectRatio,
          resolution,
        })!
          .split('x')
          .map(Number);
        expect(w * h).toBeGreaterThanOrEqual(min);
        expect(w * h).toBeLessThanOrEqual(16_777_216);
        expect(w / h).toBeGreaterThanOrEqual(1 / 16);
        expect(w / h).toBeLessThanOrEqual(16);
      }
  });
});

describe('图片参数回退与预检', () => {
  it('比例按对数距离选择，而非比例数值的线性距离', () => {
    const target = profile();
    target.params[0].values = ['1:1', '3:1'];
    expect(resolveImageParams(target, { aspectRatio: '2:1' }).params.aspectRatio).toBe('3:1');
  });
  it('统一默认值、中文标签和 notes 契约从入口导出', () => {
    expect(resolveImageParams(profile(), {})).toEqual({
      params: DEFAULT_IMAGE_PARAMS,
      changes: [],
    });
    expect(IMAGE_PARAM_LABELS.resolution).toBe('清晰度');
    expect(IMAGE_QUALITY_LABELS.max).toBe('极致');
    expect(IMAGE_BACKGROUND_LABELS.auto).toBe('自适应');
    expect(profile().params[1].notes).toEqual({ '4K': '实验' });
    expect(
      ModelProfile.safeParse({
        ...profile(),
        params: [{ ...profile().params[1], notes: { '4K': 1 } }],
      }).success,
    ).toBe(false);
  });
  it('合法值保留；不支持值按比例对数距离、降档、画质距离及背景回退', () => {
    const target = profile('openai-images', ['1K', '2K']);
    target.params[0].values = ['1:1', '16:9'];
    target.params[2].values = ['low', 'medium', 'high'];
    target.params[3].values = ['auto', 'opaque'];
    const result = resolveImageParams(target, {
      aspectRatio: '21:9',
      resolution: '4K',
      quality: 'max',
      background: 'transparent',
      size: '1024x1024',
    });
    expect(result.params).toEqual({
      aspectRatio: '16:9',
      resolution: '2K',
      quality: 'high',
      background: 'auto',
    });
    expect(result.changes).toEqual([
      { key: 'aspectRatio', from: '21:9', to: '16:9', message: '比例：21:9 → 16:9' },
      { key: 'resolution', from: '4K', to: '2K', message: '清晰度：4K → 2K' },
      { key: 'quality', from: 'max', to: 'high', message: '画质：极致 → 高' },
      { key: 'background', from: 'transparent', to: 'auto', message: '背景：透明 → 自适应' },
      { key: 'size', from: '1024x1024', to: undefined, message: '已移除size：1024x1024' },
    ]);
    expect(resolveImageParams(target, result.params)).toEqual({
      params: result.params,
      changes: [],
    });
  });
  it('清晰度无更低档时取最低档，画质等距取较低档，非法原值用默认值', () => {
    const target = profile('ark-images', ['4K', '2K']);
    target.params[2].values = ['max', 'high'];
    expect(
      resolveImageParams(target, { resolution: '1K', quality: 'xhigh', aspectRatio: '0:0' }).params,
    ).toMatchObject({ resolution: '2K', quality: 'high', aspectRatio: '1:1' });
  });
  it('整组移除仍提供提示，供应商参数按类型校验并保留合法值，不修改原对象', () => {
    const target = profile();
    target.params = [
      { key: 'watermark', name: '水印', type: 'boolean', default: true, mapped: true },
      { key: 'steps', name: '步数', type: 'number', min: 1, max: 10, default: 5, mapped: true },
    ];
    const current = { background: 'transparent', watermark: false, steps: 99 };
    const result = resolveImageParams(target, current);
    expect(result.params).toEqual({ watermark: false, steps: 5 });
    expect(result.changes[0]).toMatchObject({
      key: 'background',
      to: undefined,
      message: '已移除背景：透明',
    });
    expect(current).toEqual({ background: 'transparent', watermark: false, steps: 99 });
  });
  it.each([
    ['resolution', '1K'],
    ['aspectRatio', '4:1'],
    ['quality', 'auto'],
    ['background', 'solid'],
    ['size', '2K'],
    ['count', 4],
  ])('共享预检拒绝档案外语义值 %s=%s', (key, value) => {
    const target = profile('ark-images', ['2K', '4K']);
    const request = GenerationRequest.parse({
      modelId: '11111111-1111-4111-8111-111111111111',
      mode: 'text',
      prompt: '测试',
      params: { [key]: value },
    });
    expect(checkGenerationRequest(target, request).map((issue) => issue.field)).toContain(key);
    expect(
      checkGenerationRequest(target, {
        ...request,
        params: resolveImageParams(target, request.params).params,
      }),
    ).toEqual([]);
  });
});
