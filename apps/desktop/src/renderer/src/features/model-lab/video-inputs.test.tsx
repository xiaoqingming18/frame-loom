import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ModelProfile, type GenerationInput } from '@frame-loom/contracts';
import type { EngineClient } from '@/lib/engine-client';
import { VideoInputs } from './video-inputs';

const profile = ModelProfile.parse({
  id: 'test-video',
  name: '测试视频档案',
  kind: 'video',
  protocol: 'ark-video-tasks',
  matchIds: [],
  generic: false,
  modes: [
    { id: 'frames', name: '首尾帧' },
    { id: 'reference', name: '全模态参考' },
  ],
  params: [{ key: 'quality', name: '质量', type: 'enum', values: ['low', 'high'], default: 'low' }],
  constraints: [
    {
      when: { mode: 'reference', param: 'quality', equals: 'high', inputRole: 'first_frame' },
      forbidRoles: ['reference'],
      message: '高质量首帧模式不支持附加参考素材',
    },
  ],
  inputs: [
    { kind: 'image', maxCount: 2, maxBytes: 1024, mimeTypes: ['image/png'], transport: 'inline' },
    { kind: 'video', maxCount: 1, maxBytes: 1024, mimeTypes: ['video/mp4'], transport: 'url' },
    { kind: 'audio', maxCount: 1, maxBytes: 1024, mimeTypes: ['audio/mpeg'], transport: 'url' },
  ],
  runtime: {
    concurrency: 1,
    pollInitialMs: 1000,
    pollMaxMs: 5000,
    timeoutMs: 900000,
    submitTimeoutMs: 30000,
    supportsCancel: false,
  },
});

afterEach(cleanup);

function setup(hasSecret: boolean, mode: string, inputs: GenerationInput[], quality: string) {
  const client: EngineClient = {
    request(_path, schema) {
      return Promise.resolve(
        schema.parse({
          endpoint: 'https://s3.example.com/',
          region: 'auto',
          bucket: 'frame-loom',
          accessKeyId: 'access-key',
          forcePathStyle: true,
          keyPrefix: 'frame-loom',
          presignTtlSeconds: 86_400,
          hasSecret,
          secretNeedsUpdate: false,
        }),
      );
    },
    async *stream() {},
  };
  const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queries}>
      <VideoInputs
        client={client}
        profile={profile}
        mode={mode}
        params={{ quality }}
        inputs={inputs}
        onChange={() => {}}
        onReading={() => {}}
        disabled={false}
      />
    </QueryClientProvider>,
  );
  return queries;
}

it('未配置对象存储时禁用远端参考素材', () => {
  const queries = setup(false, 'reference', [], 'low');
  expect(screen.getByLabelText<HTMLInputElement>('参考视频').disabled).toBe(true);
  expect(screen.getAllByText('请先在设置中心配置对象存储')).toHaveLength(2);
  queries.clear();
});

it('按模式、参数和现有首帧应用条件约束，并显示档案原因', async () => {
  const queries = setup(true, 'reference', [], 'high');
  await waitFor(() =>
    expect(screen.getByLabelText<HTMLInputElement>('参考视频').disabled).toBe(false),
  );
  queries.clear();
  cleanup();

  const withFirstFrame = setup(
    true,
    'reference',
    [{ kind: 'image', role: 'first_frame', sha256: 'a'.repeat(64) }],
    'high',
  );
  const referenceAudio = await screen.findByLabelText('参考音频');
  expect((referenceAudio as HTMLInputElement).disabled).toBe(true);
  expect(screen.getAllByText('高质量首帧模式不支持附加参考素材')).toHaveLength(3);
  fireEvent.click(screen.getByRole('button', { name: '移除首帧' }));
  withFirstFrame.clear();
});
