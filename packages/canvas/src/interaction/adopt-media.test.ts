import { expect, it, vi } from 'vitest';
import { adoptMedia } from './adopt-media';
import { generationJob, media, sha } from '../test-utils';
import { toVersion } from './media-import';

it('所有版本与封面去重补齐，缺失哈希保留，未提供 adopt 的宿主可用', async () => {
  const version = toVersion(generationJob().outputs[0], sha('b'));
  const node = media('one', 'image', {
    data: {
      versions: [version, version],
      activeVersion: 0,
      prompt: '',
      inputOrder: [],
      mediaReferences: [
        {
          id: 'local',
          name: '音频',
          role: 'reference',
          media: { ...generationJob().outputs[0], sha256: sha('c'), mime: 'audio/wav' },
        },
      ],
    },
  });
  const adopt = vi.fn().mockResolvedValue({ missing: [sha('b')] });
  const host = { media: { upload: vi.fn(), url: (hash: string) => hash, adopt } };
  expect(await adoptMedia(host, [node])).toEqual([sha('b')]);
  expect(adopt).toHaveBeenCalledExactlyOnceWith([sha('a'), sha('b'), sha('c')]);
  expect(node.data).toMatchObject({ versions: [version, version] });
  expect(await adoptMedia({ media: { upload: vi.fn(), url: (hash) => hash } }, [node])).toEqual([]);
});
