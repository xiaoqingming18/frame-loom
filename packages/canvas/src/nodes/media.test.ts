import { expect, it } from 'vitest';
import { getProtocol, type VideoCap } from '@frame-loom/contracts';
import { videoInputs } from './media';
import { generationModelFixture } from '../test-utils';
import { referenceCandidateIssue } from './reference-check';

it('编辑续写只接受单个待编辑视频，素材时长执行协议规则', () => {
  const model = generationModelFixture('ark-seedance');
  if (model.capability.kind !== 'video') throw new Error('视频夹具错误');
  expect(videoInputs({ mode: 'edit' }, model.capability)).toEqual([
    { id: 'base_video', label: '待编辑视频', accepts: ['video'], max: 1 },
  ]);
  const data = {
    versions: [],
    activeVersion: 0,
    prompt: '编辑',
    inputOrder: [],
    mode: 'edit' as const,
  };
  const input = {
    kind: 'video' as const,
    role: 'base_video' as const,
    order: 0,
    sha256: 'a'.repeat(64),
  };
  expect(
    referenceCandidateIssue(model, data, [], {
      input,
      media: { mime: 'video/mp4', durationMs: 3000 },
    }),
  ).toBe('Seedance 待编辑视频至少需要 4 秒');
  expect(
    referenceCandidateIssue(model, data, [], {
      input,
      media: { mime: 'video/mp4', durationMs: 5000 },
    }),
  ).toBeUndefined();
  expect(
    referenceCandidateIssue(model, data, [], {
      input,
      media: { mime: 'video/mp4', durationMs: 31000 },
    }),
  ).toBeTruthy();
  expect(
    referenceCandidateIssue(
      model,
      data,
      [{ input, media: { mime: 'video/mp4', durationMs: 5000 } }],
      { input, media: { mime: 'video/mp4', durationMs: 5000 } },
    ),
  ).toBeTruthy();
  expect(
    referenceCandidateIssue(model, data, [], { input: { ...input, kind: 'image' }, media: {} }),
  ).toBe('当前方式不支持此素材角色或类型');
});

it('首尾帧、关键帧和参考端口取能力卡，混合方式按卡片开放', () => {
  const cap = structuredClone(getProtocol('ark-seedance')!.templates.video!);
  expect(videoInputs({ mode: 'first_last' }, cap).map((port) => port.id)).toEqual([
    'first_frame',
    'last_frame',
  ]);
  expect(videoInputs({ mode: 'first' }, cap).map((port) => port.id)).toEqual(['first_frame']);
  cap.modes = [
    { id: 'first', withReference: true },
    { id: 'keyframes', keyframes: { max: 3 } },
    { id: 'reference', reference: { accept: ['audio'], withFrames: true } },
  ];
  cap.references.totalCount = 8;
  expect(videoInputs({ mode: 'first' }, cap).map((port) => port.id)).toEqual([
    'first_frame',
    'reference',
  ]);
  expect(videoInputs({ mode: 'keyframes' }, cap)[0].max).toBe(3);
  expect(videoInputs({ mode: 'reference' }, cap)).toEqual([
    { id: 'first_frame', label: '首帧', accepts: ['image'], max: 1 },
    { id: 'last_frame', label: '尾帧', accepts: ['image'], max: 1 },
    { id: 'reference', label: '参考素材', accepts: ['audio'], max: 8 },
  ]);
});

it('真实模板中 Kling 可混合首帧与参考，Seedance 不开放', () => {
  for (const [id, expected] of [
    ['kling-omni', true],
    ['ark-seedance', false],
  ] as const) {
    const cap = getProtocol(id)!.templates.video!;
    expect(videoInputs({ mode: 'first' }, cap).some((port) => port.id === 'reference')).toBe(
      expected,
    );
  }
});

it('候选检查允许暂缺必填帧，但拒绝类型、数量和合计时长超限', () => {
  const model = generationModelFixture('ark-seedance');
  const cap = model.capability as VideoCap;
  const data = {
    versions: [],
    activeVersion: 0,
    inputOrder: [],
    prompt: '',
    mode: 'first_last' as const,
  };
  const ref = {
    input: {
      role: 'first_frame' as const,
      kind: 'image' as const,
      order: 0,
      sha256: 'a'.repeat(64),
    },
    media: { mime: 'image/png' },
  };
  expect(referenceCandidateIssue(model, data, [], ref)).toBeUndefined();
  expect(referenceCandidateIssue(model, data, [ref], ref)).toBeTruthy();
  cap.modes = [{ id: 'reference', reference: { accept: ['audio'], withFrames: false } }];
  cap.references.audio = { max: 2, maxTotalSec: 3 };
  const audio = {
    input: { ...ref.input, role: 'reference' as const, kind: 'audio' as const },
    media: { mime: 'audio/wav', durationMs: 2000 },
  };
  expect(referenceCandidateIssue(model, { ...data, mode: 'reference' }, [], ref)).toBeTruthy();
  expect(referenceCandidateIssue(model, { ...data, mode: 'reference' }, [audio], audio)).toContain(
    '总时长',
  );
});
