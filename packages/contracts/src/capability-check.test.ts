import { describe, expect, it } from 'vitest';
import {
  checkMedia,
  checkRequest,
  changeProtocol,
  effectiveCapability,
  effectiveVideoParams,
  restoreCapabilityGroup,
  validateModel,
} from './capability-check.js';
import { ModelWrite } from './model-service.js';
import { getProtocol, type ProtocolDescriptor } from './protocols.js';
import { SemanticRequest, type SemanticInput, type VideoModeId } from './semantic-request.js';
import type { ImageCap, VideoCap, TtsCap } from './capabilities.js';
import { imageEditSupport } from './image-edit.js';

const modelId = '00000000-0000-4000-8000-000000000001';
it('仅设置总时长上限时仍累计参考素材时长', () => {
  const cap = structuredClone(getProtocol('ark-seedance')!.templates.video!);
  cap.references.audio = { maxTotalSec: 5 };
  const inputs = [0, 1].map((order) => ({
    input: {
      kind: 'audio' as const,
      role: 'reference' as const,
      order,
      sha256: String(order).repeat(64),
    },
    media: { durationMs: 3000 },
  }));
  expect(checkMedia(inputs, cap).map((issue) => issue.message)).toContain('同类素材总时长超过限制');
});
const modes: VideoModeId[] = [
  't2v',
  'first',
  'last',
  'first_last',
  'keyframes',
  'reference',
  'edit',
  'extend',
];
const video: VideoCap = {
  kind: 'video',
  modes: modes.map((id) => ({
    id,
    ...(id === 'keyframes' ? { keyframes: { min: 2, max: 3 } } : {}),
    ...(id === 'reference'
      ? { reference: { accept: ['image', 'video', 'audio'], withFrames: false } }
      : {}),
  })),
  defaultMode: 't2v',
  references: {
    image: { max: 4 },
    video: { max: 2, maxDurationSec: 10, maxTotalSec: 15 },
    audio: { max: 1 },
    totalCount: 5,
  },
  duration: { kind: 'range', min: 2, max: 10, step: 2, default: 4 },
  aspectRatios: ['16:9', 'adaptive'],
  resolutions: ['720p', '1080p'],
  audio: { mode: 'optional', default: true },
  seed: true,
  promptRef: { syntax: 'ordinal', base: 1 },
};
const image: ImageCap = {
  kind: 'image',
  references: { formats: ['image/png'] },
  count: {},
  size: { wire: 'none', tiers: [], default: {} },
  outputFormats: [],
  seed: false,
  negativePrompt: false,
};
function descriptor(): ProtocolDescriptor {
  return {
    ...structuredClone(getProtocol('ark-seedance')!),
    ceiling: {
      video: {
        modes,
        referenceKinds: ['image', 'video', 'audio'],
        mixFramesWithReference: true,
        audioControl: true,
        watermark: true,
        seed: true,
        durationAuto: true,
        promptRefs: ['ordinal'],
      },
    },
    templates: { video: structuredClone(video) },
    transports: { image: { allowed: ['inline', 'url'], auto: 'inline' } },
  };
}
function input(
  role: SemanticInput['role'],
  kind: SemanticInput['kind'] = role === 'base_video' ? 'video' : 'image',
): SemanticInput {
  return { role, kind, order: 0, sha256: 'a'.repeat(64) };
}
function request(mode: VideoModeId | undefined, inputs: SemanticInput[] = [], params = {}) {
  return SemanticRequest.parse({ modelId, mode, prompt: '测试', inputs, params });
}
const model = (capability = video) => ({ kind: capability.kind, capability, extras: [] });
describe('能力校验', () => {
  it.each([
    ['t2v', []],
    ['first', [input('first_frame')]],
    ['last', [input('last_frame')]],
    ['first_last', [input('first_frame'), input('last_frame')]],
    ['keyframes', [input('keyframe'), input('keyframe')]],
    ['reference', [input('reference')]],
    ['edit', [input('base_video')]],
    ['extend', [input('base_video')]],
  ] as const)('%s 的必需角色和数量', (mode, inputs) => {
    expect(checkRequest(request(mode, [...inputs]), model(), descriptor())).toEqual([]);
    if (mode !== 't2v') expect(checkRequest(request(mode), model(), descriptor())).not.toEqual([]);
    expect(
      checkRequest(
        request(mode, [input('base_video'), input('base_video')]),
        model(),
        descriptor(),
      ),
    ).not.toEqual([]);
  });
  it('不限与 0 区分，类型、总数、混用规则一致', () => {
    const cap = structuredClone(video);
    cap.references = {};
    expect(
      checkRequest(
        request(
          'reference',
          Array.from({ length: 10 }, () => input('reference')),
        ),
        model(cap),
        descriptor(),
      ),
    ).toEqual([]);
    cap.references.image = { max: 0 };
    expect(
      checkRequest(request('reference', [input('reference')]), model(cap), descriptor()),
    ).not.toEqual([]);
    const frameAndReference = request('first', [input('first_frame'), input('reference')]);
    expect(checkRequest(frameAndReference, model(), descriptor())).not.toEqual([]);
    cap.modes.find((mode) => mode.id === 'first')!.withReference = true;
    cap.references = {};
    expect(checkRequest(frameAndReference, model(cap), descriptor())).toEqual([]);
    cap.modes.find((mode) => mode.id === 'reference')!.reference!.accept = ['image'];
    expect(
      checkRequest(request('reference', [input('reference', 'audio')]), model(cap), descriptor()),
    ).not.toEqual([]);
    expect(
      checkRequest(
        request(
          'reference',
          Array.from({ length: 6 }, () => input('reference')),
        ),
        model(),
        descriptor(),
      ),
    ).not.toEqual([]);
  });
  it('协议 only/exclude/forbidRole 同时用于拒绝和控件原因', () => {
    const d = descriptor();
    d.rules = [
      {
        when: { modes: ['first_last'] },
        then: { param: 'aspectRatio', only: ['adaptive'] },
        message: '首尾帧固定 adaptive',
      },
      {
        when: { modes: ['first_last'] },
        then: { param: 'resolution', exclude: ['1080p'] },
        message: '不支持 1080p',
      },
      {
        when: { media: { role: 'first_frame', kind: 'image' } },
        then: { forbidRole: 'reference' },
        message: '禁止参考素材',
      },
    ];
    const result = checkRequest(
      request('first_last', [input('first_frame'), input('last_frame'), input('reference')], {
        aspectRatio: '16:9',
        resolution: '1080p',
      }),
      model(),
      d,
    );
    expect(result.map((issue) => issue.message)).toEqual(
      expect.arrayContaining(['首尾帧固定 adaptive', '不支持 1080p', '禁止参考素材']),
    );
    const options = effectiveVideoParams(video, d, 'first_last', [input('first_frame')]);
    expect(options.aspectRatios[0]).toEqual({
      value: '16:9',
      disabled: true,
      reason: '首尾帧固定 adaptive',
    });
    expect(options.resolutions[1].disabled).toBe(true);
  });
  it('参数范围、步长、未知参数、extras 类型', () => {
    const d = descriptor();
    const m = {
      ...model(),
      extras: [{ key: 'steps', label: '步数', type: 'number' as const, path: 'parameters.steps' }],
    };
    expect(
      checkRequest(
        { ...request('t2v', [], { duration: 3 }), extras: { steps: 'bad', unknown: 1 } },
        m,
        d,
      ).map((issue) => issue.field),
    ).toEqual(expect.arrayContaining(['params.duration', 'extras.steps', 'extras.unknown']));
    expect(
      checkRequest(request('t2v', [], { duration: 12, seed: -1, quality: 'high' }), m, d),
    ).toHaveLength(3);
    expect(checkRequest(request('t2v', [], { duration: 4, seed: 0 }), m, d)).toEqual([]);
  });
  it('真实素材大小、格式、单个时长与合计时长，缺元数据跳过', () => {
    expect(checkMedia([{ input: input('reference'), media: {} }], image)).toEqual([]);
    expect(
      checkMedia([{ input: input('reference'), media: { mime: 'image/jpeg', bytes: 11 } }], {
        ...image,
        references: { formats: ['png'], maxBytes: 10 },
      }),
    ).toHaveLength(2);
    expect(
      checkMedia([{ input: input('reference', 'video'), media: { durationMs: 11000 } }], video),
    ).toHaveLength(1);
    expect(
      checkMedia(
        [1, 2].map(() => ({ input: input('reference', 'video'), media: { durationMs: 8000 } })),
        video,
      ),
    ).toHaveLength(1);
  });
  it('图像参考数、TTS 风格、格式与字数', () => {
    const imageDescriptor = getProtocol('openai-images')!;
    expect(
      checkRequest(
        request(undefined, [input('reference')]),
        { kind: 'image', capability: image, extras: [] },
        imageDescriptor,
      ),
    ).toEqual([]);
    expect(
      checkRequest(
        request(undefined, [input('reference')]),
        {
          kind: 'image',
          capability: { ...image, references: { ...image.references, max: 0 } },
          extras: [],
        },
        imageDescriptor,
      ),
    ).not.toEqual([]);
    const tts: TtsCap = {
      kind: 'tts',
      voices: { sources: ['manual'], presets: [] },
      instructions: false,
      formats: [],
      sampleRates: [],
      maxChars: 1,
    };
    expect(
      checkRequest(
        request(undefined, [], { speed: 2 }),
        { kind: 'tts', capability: tts, extras: [] },
        getProtocol('openai-speech')!,
      ).map((issue) => issue.field),
    ).toEqual(['prompt', 'params.speed']);
  });
});
describe('配置保存和协议变更', () => {
  const write = () =>
    ModelWrite.parse({
      kind: 'video',
      upstreamModelId: 'test',
      displayName: '测试',
      protocolId: 'ark-seedance',
      capability: video,
      enabled: true,
    });
  const channel = { baseUrl: 'https://a.test/v1', hasSecretKey: false };
  it('空协议、类别、上限、传输、跨主机和地址问题', () => {
    expect(validateModel(write(), descriptor(), channel)).toEqual([]);
    expect(validateModel(write(), undefined, channel)[0].field).toBe('protocolId');
    expect(validateModel({ ...write(), enabled: false }, undefined, channel)).toEqual([]);
    expect(validateModel(write(), getProtocol('openai-chat'), channel)[0].field).toBe('protocolId');
    const invalid = {
      ...write(),
      transport: { video: 'inline' as const },
      endpointOverride: { submitUrl: 'https://other.test/custom', confirmedHosts: [] },
    };
    expect(validateModel(invalid, descriptor(), channel).map((issue) => issue.field)).toEqual(
      expect.arrayContaining([
        'transport.video',
        'endpointOverride',
        'endpointOverride.confirmedHosts',
      ]),
    );
    const d = descriptor();
    d.ceiling.video!.seed = false;
    expect(validateModel(write(), d, channel).map((issue) => issue.field)).toContain(
      'capability.seed',
    );
  });
  it('保留字段的父子路径与 multipart 多段字段拒绝', () => {
    const d = descriptor();
    d.reservedFields = ['parameters.model'];
    const m = { ...write(), fixedFields: [{ path: 'parameters', value: {} }] };
    expect(validateModel(m, d, channel)[0].message).toContain('保留');
    d.operations.submit!.encoding = 'multipart';
    expect(
      validateModel(
        { ...write(), fixedFields: [{ path: 'parameters.steps', value: 1 }] },
        d,
        channel,
      )[0].message,
    ).toContain('multipart');
  });
  it('协议切换保留兼容值，列出冲突和地址，不修改原对象', () => {
    const current = ModelWrite.parse({
      kind: 'chat',
      upstreamModelId: 'test',
      displayName: '测试',
      protocolId: 'openai-chat',
      capability: {
        ...getProtocol('openai-chat')!.templates.chat!,
        contextWindow: 1234,
        tools: true,
      },
      enabled: false,
      endpointOverride: { submitUrl: 'https://a.test/custom', confirmedHosts: [] },
      extras: [{ key: 'x', label: 'x', type: 'string', path: 'messages' }],
      transport: { image: 'url' },
    });
    const { model: changed, incompatible } = changeProtocol(current, 'anthropic-messages');
    expect(changed.capability).toMatchObject({ contextWindow: 1234, tools: true });
    expect(changed.endpointOverride).toEqual({ confirmedHosts: [] });
    expect(changed.extras).toEqual([]);
    expect(changed.transport.image).toBe('auto');
    expect(incompatible.map((issue) => issue.field)).toEqual(
      expect.arrayContaining(['endpointOverride', 'extras.messages', 'transport.image']),
    );
    expect(current.capability).toMatchObject({ tools: true });
  });
  it('恢复只改变所选分组，有效能力不修改原对象', () => {
    const modified = { ...video, duration: { kind: 'auto' as const }, promptMaxChars: 200 };
    expect(restoreCapabilityGroup(modified, descriptor(), 'duration')).toEqual({
      ...modified,
      duration: video.duration,
    });
    const d = descriptor();
    d.ceiling.video!.modes = ['t2v'];
    expect(effectiveCapability(video, d).modes).toHaveLength(1);
    expect(video.modes).toHaveLength(8);
  });
  it('首次选择协议填完整模板，文本输入分组恢复不影响长度', () => {
    const d = getProtocol('openai-chat')!;
    const empty = ModelWrite.parse({
      kind: 'chat',
      upstreamModelId: 'new',
      displayName: '新模型',
      enabled: false,
      protocolId: null,
      capability: {
        kind: 'chat',
        inputModalities: [],
        tools: false,
        streaming: false,
        reasoningLevels: [],
        samplingParams: [],
      },
    });
    expect(changeProtocol(empty, d.id).model.capability).toEqual(d.templates.chat);
    const cap = {
      ...structuredClone(d.templates.chat!),
      contextWindow: 321,
      tools: false,
      streaming: false,
      inputModalities: [],
    };
    expect(restoreCapabilityGroup(cap, d, 'references')).toEqual({
      ...d.templates.chat,
      contextWindow: 321,
    });
  });
  it.each([0, 1, 2, 3, undefined])('编辑工具参考图边界 %s', (max) => {
    const d = structuredClone(getProtocol('openai-images')!);
    d.ceiling.image!.edit = true;
    d.ceiling.image!.mask = ['alpha'];
    const support = imageEditSupport(
      { ...image, references: { formats: [], max }, mask: { semantics: 'alpha' } },
      d,
    );
    expect(support.angle.available).toBe(max === undefined || max >= 1);
    expect(support.lighting.available).toBe(support.angle.available);
    expect(support.emotion.available).toBe(max === undefined || max >= 2);
    expect(support.emotion.mask).toBe(max === undefined || max >= 3);
    d.ceiling.image!.edit = false;
    expect(imageEditSupport(image, d).emotion.available).toBe(false);
  });
});
