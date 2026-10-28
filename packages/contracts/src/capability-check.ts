import type { Capability, VideoCap } from './capabilities.js';
import type { MediaFile } from './generation.js';
import type { ModelWrite } from './model-service.js';
import { resolveEndpoints } from './endpoints.js';
import { resolveImageSize } from './image-size.js';
import { getProtocol, type ProtocolDescriptor, type ProtocolRule } from './protocols.js';
import type { SemanticInput, SemanticRequest, Value, VideoModeId } from './semantic-request.js';

export type CapabilityIssue = { field: string; message: string };
export function effectiveCapability<T extends Capability>(
  cap: T,
  descriptor: ProtocolDescriptor,
): T {
  const result = structuredClone(cap);
  if (result.kind === 'chat') {
    const ceiling = descriptor.ceiling.chat;
    if (!ceiling) throw new Error('协议不支持文本能力');
    result.inputModalities = result.inputModalities.filter((value) =>
      ceiling.inputModalities.includes(value),
    );
    result.samplingParams = result.samplingParams.filter((value) =>
      ceiling.samplingParams.includes(value),
    );
    result.tools &&= ceiling.tools;
    if (!ceiling.reasoning) result.reasoningLevels = [];
  } else if (result.kind === 'image') {
    const ceiling = descriptor.ceiling.image;
    if (!ceiling) throw new Error('协议不支持图像能力');
    if (result.mask && !ceiling.mask.includes(result.mask.semantics)) delete result.mask;
    if (result.background && !ceiling.transparentBackground) {
      result.background.transparent = false;
      if (result.background.default === 'transparent') result.background.default = 'auto';
    }
    if (result.responseFormat && !ceiling.responseFormats.includes(result.responseFormat))
      delete result.responseFormat;
    result.outputFormats = result.outputFormats.filter((value) =>
      ceiling.outputFormats.includes(value),
    );
    if (!ceiling.compression) delete result.compression;
    if (!ceiling.quality) delete result.quality;
    if (!ceiling.sizeWire.includes(result.size.wire))
      result.size = structuredClone(
        descriptor.templates.image?.size ?? { wire: 'none', tiers: [], default: {} },
      );
    result.seed &&= ceiling.seed;
    result.negativePrompt &&= ceiling.negativePrompt;
  } else if (result.kind === 'video') {
    const ceiling = descriptor.ceiling.video;
    if (!ceiling) throw new Error('协议不支持视频能力');
    result.modes = result.modes
      .filter((mode) => ceiling.modes.includes(mode.id))
      .map((mode) => ({
        ...mode,
        ...(mode.withReference !== undefined
          ? { withReference: mode.withReference && ceiling.mixFramesWithReference }
          : {}),
        ...(mode.reference
          ? {
              reference: {
                accept: mode.reference.accept.filter((kind) =>
                  ceiling.referenceKinds.includes(kind),
                ),
                withFrames: mode.reference.withFrames && ceiling.mixFramesWithReference,
              },
            }
          : {}),
      }));
    if (!result.modes.some((mode) => mode.id === result.defaultMode) && result.modes[0])
      result.defaultMode = result.modes[0].id;
    for (const kind of ['image', 'video', 'audio'] as const)
      if (!ceiling.referenceKinds.includes(kind)) delete result.references[kind];
    if (!ceiling.audioControl && result.audio.mode === 'optional')
      result.audio = structuredClone(descriptor.templates.video?.audio ?? { mode: 'unknown' });
    if (!ceiling.watermark) delete result.watermark;
    result.seed &&= ceiling.seed;
    if (!ceiling.durationAuto && result.duration.kind !== 'auto') delete result.duration.allowAuto;
    if (!ceiling.durationAuto && result.duration.kind === 'auto' && descriptor.templates.video)
      result.duration = structuredClone(descriptor.templates.video.duration);
    if (!ceiling.promptRefs.includes(result.promptRef.syntax) && descriptor.templates.video)
      result.promptRef = structuredClone(descriptor.templates.video.promptRef);
  } else {
    const ceiling = descriptor.ceiling.tts;
    if (!ceiling) throw new Error('协议不支持 TTS 能力');
    result.voices.sources = result.voices.sources.filter((value) =>
      ceiling.voiceSources.includes(value),
    );
    result.instructions &&= ceiling.instructions;
    if (!ceiling.speed) delete result.speed;
    if (!ceiling.pitch) delete result.pitch;
    if (!ceiling.volume) delete result.volume;
    if (!ceiling.multiSpeaker) delete result.multiSpeaker;
    result.formats = result.formats.filter((value) => ceiling.formats.includes(value));
    result.sampleRates = result.sampleRates.filter((value) => ceiling.sampleRates.includes(value));
    if (result.defaultFormat && !result.formats.includes(result.defaultFormat))
      delete result.defaultFormat;
    if (
      result.defaultSampleRate !== undefined &&
      !result.sampleRates.includes(result.defaultSampleRate)
    )
      delete result.defaultSampleRate;
  }
  return result;
}
function differences(
  from: unknown,
  to: unknown,
  path = '',
): { field: string; from: unknown; message: string }[] {
  if (JSON.stringify(from) === JSON.stringify(to)) return [];
  if (
    from &&
    to &&
    typeof from === 'object' &&
    typeof to === 'object' &&
    !Array.isArray(from) &&
    !Array.isArray(to)
  ) {
    const a = from as Record<string, unknown>;
    const b = to as Record<string, unknown>;
    return [...new Set([...Object.keys(a), ...Object.keys(b)])].flatMap((key) =>
      differences(a[key], b[key], path ? `${path}.${key}` : key),
    );
  }
  return [{ field: path, from, message: '此字段不兼容当前协议' }];
}
function reserved(path: string, descriptor: ProtocolDescriptor) {
  return descriptor.reservedFields.some(
    (field) =>
      path === field ||
      (!descriptor.extensibleContainers?.includes(field) && path.startsWith(`${field}.`)) ||
      field.startsWith(`${path}.`),
  );
}
export function validateModel(
  write: ModelWrite,
  descriptor: ProtocolDescriptor | undefined,
  channel: { baseUrl: string; hasSecretKey: boolean },
): CapabilityIssue[] {
  const issues: CapabilityIssue[] = [];
  if (!descriptor)
    return write.enabled ? [{ field: 'protocolId', message: '请先选择有效协议再启用' }] : [];
  if (!descriptor.kinds.includes(write.kind))
    return [{ field: 'protocolId', message: '协议不支持此类别' }];
  issues.push(
    ...differences(
      write.capability,
      effectiveCapability(write.capability, descriptor),
      'capability',
    ),
  );
  for (const [kind, transport] of Object.entries(write.transport)) {
    const allowed = descriptor.transports[kind as keyof typeof descriptor.transports]?.allowed;
    if (transport !== 'auto' && !allowed?.includes(transport))
      issues.push({ field: `transport.${kind}`, message: '协议不支持此素材传输方式' });
  }
  const multipart = Object.values(descriptor.operations).some(
    (operation) => operation.encoding === 'multipart',
  );
  for (const [group, fields] of [
    ['extras', write.extras],
    ['fixedFields', write.fixedFields],
  ] as const)
    fields.forEach((field, index) => {
      if (reserved(field.path, descriptor))
        issues.push({ field: `${group}.${index}.path`, message: '不能覆盖协议保留字段' });
      if (descriptor.extraPathPrefix && !field.path.startsWith(descriptor.extraPathPrefix))
        issues.push({
          field: `${group}.${index}.path`,
          message: '该协议附加参数与固定字段必须写入 metadata',
        });
      if (multipart && field.path.includes('.'))
        issues.push({ field: `${group}.${index}.path`, message: 'multipart 只允许顶层字段' });
    });
  const endpoints = resolveEndpoints(channel, write, descriptor);
  if (write.enabled) {
    issues.push(...endpoints.issues.map((message) => ({ field: 'endpointOverride', message })));
    for (const host of endpoints.foreignHosts)
      if (!write.endpointOverride.confirmedHosts.includes(host))
        issues.push({
          field: 'endpointOverride.confirmedHosts',
          message: `请确认外部主机：${host}`,
        });
  }
  return issues;
}
function ruleMatches(
  rule: ProtocolRule,
  mode: VideoModeId | undefined,
  params: SemanticRequest['params'],
  inputs: SemanticInput[],
) {
  return (
    (!rule.when.modes || (mode !== undefined && rule.when.modes.includes(mode))) &&
    (!rule.when.param || params[rule.when.param.key] === rule.when.param.equals) &&
    (!rule.when.media ||
      inputs.some(
        (input) => input.role === rule.when.media?.role && input.kind === rule.when.media.kind,
      ))
  );
}
export function checkRequest(
  request: SemanticRequest,
  model: Pick<ModelWrite, 'kind' | 'capability' | 'extras'>,
  descriptor: ProtocolDescriptor,
): CapabilityIssue[] {
  if (model.kind !== model.capability.kind || !descriptor.kinds.includes(model.kind))
    return [{ field: 'modelId', message: '模型类别与协议或能力卡不一致' }];
  const cap = effectiveCapability(model.capability, descriptor);
  const issues: CapabilityIssue[] = [];
  const add = (field: string, message: string) => {
    issues.push({ field, message });
  };
  const maxChars =
    cap.kind === 'tts' ? cap.maxChars : cap.kind === 'chat' ? undefined : cap.promptMaxChars;
  if (maxChars !== undefined && request.prompt.length > maxChars)
    add('prompt', `最多 ${maxChars} 字符`);
  const params = request.params;
  const allowed = new Set<string>();
  const choices = (key: keyof typeof params, values: readonly Value[]) => {
    allowed.add(key);
    if (params[key] !== undefined && !values.includes(params[key]))
      add(`params.${key}`, '参数不在能力卡可选值内');
  };
  const range = (
    key: keyof typeof params,
    min: number | undefined,
    max: number | undefined,
    integer = false,
  ) => {
    allowed.add(key);
    const value = params[key];
    if (
      value !== undefined &&
      (typeof value !== 'number' ||
        !Number.isFinite(value) ||
        (integer && !Number.isInteger(value)) ||
        (min !== undefined && value < min) ||
        (max !== undefined && value > max))
    )
      add(`params.${key}`, '参数超出能力卡范围');
  };
  if (cap.kind === 'video') {
    const mode = cap.modes.find((mode) => mode.id === request.mode);
    if (!mode) add('mode', '请选择模型支持的生成方式');
    const counts = (role: SemanticInput['role']) =>
      request.inputs.filter((input) => input.role === role).length;
    const required: Partial<Record<VideoModeId, SemanticInput['role'][]>> = {
      first: ['first_frame'],
      last: ['last_frame'],
      first_last: ['first_frame', 'last_frame'],
      edit: ['base_video'],
      extend: ['base_video'],
    };
    for (const role of request.mode ? (required[request.mode] ?? []) : [])
      if (counts(role) !== 1) add('inputs', `当前方式需要 1 个 ${role}`);
    const permitted = new Set<SemanticInput['role']>(
      request.mode ? (required[request.mode] ?? []) : [],
    );
    if (request.mode === 'keyframes') {
      permitted.add('keyframe');
      const count = counts('keyframe');
      if (
        count < (mode?.keyframes?.min ?? 1) ||
        (mode?.keyframes?.max !== undefined && count > mode.keyframes.max)
      )
        add('inputs', '关键帧数量超出限制');
    }
    if (request.mode === 'reference') {
      permitted.add('reference');
      if (!counts('reference')) add('inputs', '至少需要一个参考素材');
      if (mode?.reference?.withFrames) {
        permitted.add('first_frame');
        permitted.add('last_frame');
      }
    }
    if (mode?.withReference) permitted.add('reference');
    for (const input of request.inputs) {
      if (!permitted.has(input.role)) add('inputs', '当前方式不允许混用此素材角色');
      if (['first_frame', 'last_frame', 'keyframe'].includes(input.role) && input.kind !== 'image')
        add('inputs', '帧素材必须为图片');
      if (input.role === 'base_video' && input.kind !== 'video')
        add('inputs', '待编辑素材必须为视频');
      if (
        input.role === 'reference' &&
        !(mode?.reference?.accept ?? descriptor.ceiling.video?.referenceKinds ?? []).includes(
          input.kind,
        )
      )
        add('inputs', '参考素材类型不支持');
    }
    for (const role of ['first_frame', 'last_frame', 'base_video'] as const)
      if (counts(role) > 1) add('inputs', `${role} 最多一个`);
    for (const kind of ['image', 'video', 'audio'] as const) {
      const count = request.inputs.filter((input) => input.kind === kind).length;
      const max = cap.references[kind]?.max;
      if (max !== undefined && count > max) add('inputs', `${kind} 数量超过限制`);
    }
    if (
      cap.references.totalCount !== undefined &&
      request.inputs.length > cap.references.totalCount
    )
      add('inputs', '素材总数超过限制');
    choices('aspectRatio', cap.aspectRatios);
    if (descriptor.customVideoSize) {
      range('width', 1, undefined, true);
      range('height', 1, undefined, true);
      if ((params.width === undefined) !== (params.height === undefined))
        add('params.width', '视频自定义宽高必须同时填写');
    }
    choices('resolution', cap.resolutions);
    if (cap.duration.kind === 'values')
      choices('duration', [...cap.duration.values, ...(cap.duration.allowAuto ? [-1] : [])]);
    else if (cap.duration.kind === 'range') {
      allowed.add('duration');
      if (!(params.duration === -1 && cap.duration.allowAuto)) {
        range('duration', cap.duration.min, cap.duration.max);
        if (
          params.duration !== undefined &&
          Math.abs(
            (params.duration - cap.duration.min) / cap.duration.step -
              Math.round((params.duration - cap.duration.min) / cap.duration.step),
          ) > 1e-8
        )
          add('params.duration', '时长不符合步长');
      }
    } else choices('duration', [-1]);
    if (cap.audio.mode === 'optional') choices('audio', [true, false]);
    else if (cap.audio.mode !== 'unknown') choices('audio', [cap.audio.mode === 'on']);
    if (cap.watermark) choices('watermark', [true, false]);
    if (cap.seed) range('seed', 0, undefined, true);
  } else if (cap.kind === 'image') {
    if (request.mode !== undefined) add('mode', '图像请求不使用视频方式');
    if (request.inputs.some((input) => input.kind !== 'image' || input.role !== 'reference'))
      add('inputs', '图像请求只接受参考图片');
    if (cap.references.max !== undefined && request.inputs.length > cap.references.max)
      add('inputs', '参考图数量超过限制');
    range('count', 1, cap.count.max, true);
    if (cap.size.wire !== 'none') {
      for (const key of ['tier', 'aspectRatio', ...(cap.size.custom ? ['width', 'height'] : [])])
        allowed.add(key);
      const size = resolveImageSize(cap, params, request.inputs.length > 0);
      if (size.issue) add('params.size', size.issue);
    }
    if (cap.quality) choices('quality', cap.quality.values);
    if (cap.background)
      choices('background', [
        'auto',
        'opaque',
        ...(cap.background.transparent ? ['transparent'] : []),
      ]);
    choices('outputFormat', cap.outputFormats);
    if (cap.compression) range('compression', cap.compression.min, cap.compression.max);
    if (cap.seed) range('seed', 0, undefined, true);
    if (cap.negativePrompt) allowed.add('negativePrompt');
  } else if (cap.kind === 'tts') {
    if (request.mode !== undefined || request.inputs.length)
      add('inputs', 'TTS 不接受视频方式或参考素材');
    allowed.add('voice');
    if (
      params.voice !== undefined &&
      !cap.voices.sources.some((source) => source === 'manual' || source === 'remote') &&
      !cap.voices.presets.some((voice) => voice.id === params.voice)
    )
      add('params.voice', '音色不在预置列表内');
    if (cap.instructions) allowed.add('instructions');
    for (const key of ['speed', 'pitch', 'volume'] as const)
      if (cap[key]) range(key, cap[key].min, cap[key].max);
    choices('format', cap.formats);
    choices('sampleRate', cap.sampleRates);
  } else if (request.mode !== undefined) add('mode', '文本请求不使用视频方式');
  for (const key of Object.keys(params))
    if (!allowed.has(key)) add(`params.${key}`, '能力卡未开放此参数');
  for (const [key, value] of Object.entries(request.extras)) {
    const param = model.extras.find((param) => param.key === key);
    if (
      !param ||
      (param.type === 'enum' ? !param.values?.includes(value) : typeof value !== param.type)
    )
      add(`extras.${key}`, '附加参数未声明或类型不匹配');
  }
  for (const rule of descriptor.rules) {
    if (!ruleMatches(rule, request.mode, params, request.inputs)) continue;
    const then = rule.then;
    if ('forbidRole' in then) {
      if (request.inputs.some((input) => input.role === then.forbidRole))
        add('inputs', rule.message);
    } else {
      const value = params[then.param];
      if (
        value !== undefined &&
        ('only' in then ? !then.only.includes(value) : then.exclude.includes(value))
      )
        add(`params.${then.param}`, rule.message);
    }
  }
  return issues;
}
export function checkMedia(
  inputs: { input: SemanticInput; media: Partial<MediaFile> }[],
  cap: Capability,
): CapabilityIssue[] {
  const issues: CapabilityIssue[] = [];
  for (const kind of ['image', 'video', 'audio'] as const) {
    const group = inputs.filter((item) => item.input.kind === kind);
    const limit =
      cap.kind === 'video'
        ? cap.references[kind]
        : cap.kind === 'image' && kind === 'image'
          ? cap.references
          : undefined;
    if (!limit) continue;
    if (limit.max !== undefined && group.length > limit.max)
      issues.push({ field: 'inputs', message: `${kind} 数量超过限制` });
    let total = 0;
    for (const { media } of group) {
      if (
        media.mime &&
        limit.formats?.length &&
        !limit.formats.includes(media.mime) &&
        !limit.formats.includes(media.mime.split('/')[1])
      )
        issues.push({ field: 'inputs', message: '素材格式不支持' });
      if (media.bytes !== undefined && limit.maxBytes !== undefined && media.bytes > limit.maxBytes)
        issues.push({ field: 'inputs', message: '素材大小超过限制' });
      if (media.durationMs != null && 'maxDurationSec' in limit) {
        const seconds = media.durationMs / 1000;
        total += seconds;
        if (
          (limit.minDurationSec !== undefined && seconds < limit.minDurationSec) ||
          (limit.maxDurationSec !== undefined && seconds > limit.maxDurationSec)
        )
          issues.push({ field: 'inputs', message: '素材时长超出限制' });
      }
    }
    if ('maxTotalSec' in limit && limit.maxTotalSec !== undefined && total > limit.maxTotalSec)
      issues.push({ field: 'inputs', message: '同类素材总时长超过限制' });
  }
  return issues;
}
export function effectiveVideoParams(
  cap: VideoCap,
  descriptor: ProtocolDescriptor,
  mode: VideoModeId,
  inputs: SemanticInput[],
) {
  const duration = cap.duration;
  const durations =
    duration.kind === 'auto'
      ? [-1]
      : duration.kind === 'values'
        ? [...duration.values]
        : Array.from(
            {
              length: Math.min(
                10000,
                Math.max(0, Math.floor((duration.max - duration.min) / duration.step) + 1),
              ),
            },
            (_, i) => duration.min + i * duration.step,
          );
  if (duration.kind !== 'auto' && duration.allowAuto) durations.push(-1);
  const options = <T extends Value>(key: keyof SemanticRequest['params'], values: T[]) =>
    values.map((value) => {
      const params = { [key]: value };
      const rule = descriptor.rules.find((rule) => {
        if (
          !ruleMatches(rule, mode, params, inputs) ||
          !('param' in rule.then) ||
          rule.then.param !== key
        )
          return false;
        return 'only' in rule.then
          ? !rule.then.only.includes(value)
          : rule.then.exclude.includes(value);
      });
      return { value, disabled: !!rule, ...(rule ? { reason: rule.message } : {}) };
    });
  return {
    aspectRatios: options('aspectRatio', cap.aspectRatios),
    resolutions: options('resolution', cap.resolutions),
    durations: options('duration', durations),
    audio: options(
      'audio',
      cap.audio.mode === 'unknown'
        ? []
        : cap.audio.mode === 'optional'
          ? [true, false]
          : [cap.audio.mode === 'on'],
    ),
  };
}
export function changeProtocol(write: ModelWrite, nextId: string) {
  const descriptor = getProtocol(nextId);
  const template = descriptor?.templates[write.kind];
  if (!descriptor || !template) throw new Error('协议不支持当前模型类别');
  const model = structuredClone(write);
  model.protocolId = nextId;
  model.capability = effectiveCapability(write.capability, descriptor);
  const incompatible = differences(write.capability, model.capability, 'capability');
  const keepField = (group: string, item: { path: string }) => {
    if (
      !reserved(item.path, descriptor) &&
      !(
        item.path.includes('.') &&
        Object.values(descriptor.operations).some((operation) => operation.encoding === 'multipart')
      )
    )
      return true;
    incompatible.push({
      field: `${group}.${item.path}`,
      from: item,
      message: '与新协议请求字段冲突',
    });
    return false;
  };
  model.extras = model.extras.filter((item) => keepField('extras', item));
  model.fixedFields = model.fixedFields.filter((item) => keepField('fixedFields', item));
  for (const item of descriptor.defaultExtras ?? [])
    if (
      !model.extras.some((existing) => existing.key === item.key || existing.path === item.path) &&
      !model.fixedFields.some((existing) => existing.path === item.path)
    )
      model.extras.push(structuredClone(item));
  for (const kind of ['image', 'video', 'audio'] as const) {
    const value = model.transport[kind];
    if (value && value !== 'auto' && !descriptor.transports[kind]?.allowed.includes(value)) {
      incompatible.push({
        field: `transport.${kind}`,
        from: value,
        message: '新协议不支持此传输方式',
      });
      model.transport[kind] = 'auto';
    }
  }
  if (
    write.endpointOverride.submitUrl ||
    Object.keys(write.endpointOverride.operations ?? {}).length ||
    write.endpointOverride.confirmedHosts.length
  )
    incompatible.push({
      field: 'endpointOverride',
      from: write.endpointOverride,
      message: '切换协议后需重新确认地址覆盖',
    });
  model.endpointOverride = { confirmedHosts: [] };
  return { model, incompatible };
}
export type CapabilityGroup =
  | 'references'
  | 'size'
  | 'quality'
  | 'output'
  | 'modes'
  | 'duration'
  | 'frame'
  | 'audio'
  | 'voices'
  | 'style'
  | 'limits';
export function restoreCapabilityGroup<T extends Capability>(
  cap: T,
  descriptor: ProtocolDescriptor,
  group: CapabilityGroup,
): T {
  const template = descriptor.templates[cap.kind];
  if (!template) throw new Error('协议缺少能力模板');
  const fields: Record<CapabilityGroup, string[]> = {
    references: ['references', 'mask'],
    size: ['size'],
    quality: ['quality', 'background'],
    output: [
      'responseFormat',
      'outputFormats',
      'compression',
      'formats',
      'defaultFormat',
      'sampleRates',
      'defaultSampleRate',
    ],
    modes: ['modes', 'defaultMode'],
    duration: ['duration'],
    frame: ['aspectRatios', 'defaultAspectRatio', 'resolutions', 'defaultResolution'],
    audio: ['audio', 'watermark'],
    voices: ['voices'],
    style: ['instructions', 'speed', 'pitch', 'volume'],
    limits: ['contextWindow', 'maxOutput', 'promptMaxChars', 'maxChars', 'count', 'multiSpeaker'],
  };
  const result = structuredClone(cap) as T & Record<string, unknown>;
  const source = template as unknown as Record<string, unknown>;
  for (const key of fields[group]) {
    if (Object.hasOwn(source, key)) result[key] = structuredClone(source[key]);
    else delete result[key];
  }
  return result;
}
