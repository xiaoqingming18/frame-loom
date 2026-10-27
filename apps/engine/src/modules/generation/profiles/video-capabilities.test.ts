import { expect, it } from 'vitest';
import {
  checkGenerationRequest,
  checkGenerationMedia,
  executableGenerationModes,
  generationParamReason,
  generationRoleReason,
  type GenerationRequest,
} from '@frame-loom/contracts';
import { videoProfiles } from './video-profiles.js';

const ids = [
  'doubao-seedance-2-5-260628',
  'doubao-seedance-2-0-260128',
  'doubao-seedance-2-0-fast-260128',
  'kling-v4',
  'kling-v3',
  'wan-3.0',
  'minimax-h3',
];
const request = (id: string): GenerationRequest => ({
  modelId: '00000000-0000-4000-8000-000000000000',
  mode: 'text',
  prompt: '测试',
  params: Object.fromEntries(
    videoProfiles
      .find((profile) => profile.id === id)!
      .params.map((param) => [param.key, param.default]),
  ),
  inputs: [],
  source: 'canvas',
});
const first = { kind: 'image', role: 'first_frame', sha256: 'a'.repeat(64) } as const;
const last = { ...first, role: 'last_frame' } as const;

it.each(ids)('%s 的文生、首帧、尾帧条件与 UI 角色判断一致', (id) => {
  const profile = videoProfiles.find((item) => item.id === id)!;
  const base = request(id);
  expect(checkGenerationRequest(profile, base)).toEqual([]);
  const frames = { ...base, mode: 'frames', inputs: [first] };
  expect(generationRoleReason(profile, frames, 'first_frame', 'image')).toBeUndefined();
  expect(checkGenerationRequest(profile, frames)).toEqual([]);
  expect(
    checkGenerationRequest(profile, { ...frames, inputs: [last] }).some((issue) =>
      issue.message.includes('首帧'),
    ),
  ).toBe(true);
  const forbidden = !!generationRoleReason(profile, frames, 'last_frame', 'image');
  expect(checkGenerationRequest(profile, { ...frames, inputs: [first, last] }).length > 0).toBe(
    forbidden,
  );
  expect(
    checkGenerationRequest(profile, {
      ...frames,
      inputs: [first, { ...first, role: 'reference' }],
    }),
  ).not.toEqual([]);
});

it('MiniMax 的条件参数在 UI 置灰并被提交校验拒绝；UTF-8 提示词边界同源', () => {
  const profile = videoProfiles.find((item) => item.id === 'minimax-h3')!;
  expect(generationParamReason(profile, request(profile.id), 'ratio', 'adaptive')).toBe(
    '文生视频必须指定画面比例',
  );
  expect(
    checkGenerationRequest(profile, { ...request(profile.id), prompt: '中'.repeat(7001) })[0].field,
  ).toBe('prompt');
  const bytes = { ...profile, promptMaxBytes: 6 };
  expect(checkGenerationRequest(bytes, { ...request(profile.id), prompt: '中文' })).toEqual([]);
  expect(checkGenerationRequest(bytes, { ...request(profile.id), prompt: '中文字' })[0].field).toBe(
    'prompt',
  );
});

it('额外定义复用现有模式和声音策略，未实现操作既不展示也不提交', () => {
  const profile = {
    ...videoProfiles[0],
    id: 'fixture-next-video',
    audioOutput: 'fixed-off' as const,
    modes: [
      { id: 'text', name: '新文生' },
      { id: 'extend', name: '延长' },
    ],
  };
  expect(executableGenerationModes(profile).map((mode) => mode.id)).toEqual(['text']);
  expect(
    checkGenerationRequest(profile, {
      ...request(videoProfiles[0].id),
      params: { generate_audio: true },
    }).some((issue) => issue.field === 'generate_audio'),
  ).toBe(true);
  expect(
    checkGenerationRequest(profile, { ...request(videoProfiles[0].id), mode: 'extend' }).some(
      (issue) => issue.field === 'mode',
    ),
  ).toBe(true);
});

it('素材总时长、实际类型和元数据边界采用共享校验', () => {
  const profile = videoProfiles[0];
  const input = { kind: 'video' as const, role: 'reference' as const, sha256: 'a'.repeat(64) };
  const media = {
    mime: 'video/mp4',
    bytes: 100,
    width: 256,
    height: 256,
    fps: 24,
    codec: 'h264',
    durationMs: 8000,
  };
  expect(checkGenerationMedia(profile, [{ input, media }])).toEqual([]);
  expect(
    checkGenerationMedia(profile, [
      { input, media },
      { input, media },
    ])[0].message,
  ).toContain('总时长');
  expect(checkGenerationMedia(profile, [{ input, media: { ...media, fps: 10 } }])[0].field).toBe(
    'inputs.0',
  );
});
