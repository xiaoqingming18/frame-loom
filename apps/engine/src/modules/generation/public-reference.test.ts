import { expect, it, vi } from 'vitest';
import { lookup } from 'node:dns/promises';
import { isPublicAddress, publicReference } from './public-reference.js';

vi.mock('node:dns/promises', () => ({ lookup: vi.fn() }));
it('拒绝私网、保留地址、IPv4 映射、混合 DNS 和带凭据地址', async () => {
  for (const address of [
    '127.0.0.1',
    '10.1.1.1',
    '100.64.0.1',
    '169.254.1.1',
    '172.16.0.1',
    '192.168.1.1',
    '224.0.0.1',
    '::1',
    '::ffff:8.8.8.8',
    'fc00::1',
    'fe80::1',
    '2001:db8::1',
  ])
    expect(isPublicAddress(address), address).toBe(false);
  expect(isPublicAddress('8.8.8.8')).toBe(true);
  expect(isPublicAddress('2606:4700:4700::1111')).toBe(true);
  vi.mocked(lookup).mockResolvedValueOnce([
    { address: '8.8.8.8', family: 4 },
    { address: '10.0.0.1', family: 4 },
  ] as never);
  await expect(publicReference('https://mixed.test/file')).rejects.toThrow('私网');
  await expect(publicReference('https://user:secret@8.8.8.8/file')).rejects.toThrow('凭据');
  await expect(publicReference('http://[::1]/file')).rejects.toThrow('私网');
  await expect(publicReference('https://8.8.8.8/file')).resolves.toBe('https://8.8.8.8/file');
});
