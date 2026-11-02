import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { ProjectProfile } from '@frame-loom/contracts';
import { ProfileFields } from './profile-fields';
import { EpisodeDialog } from './episodes/episode-dialog';
const { request, navigate } = vi.hoisted(() => ({ request: vi.fn(), navigate: vi.fn() }));
vi.mock('@tanstack/react-router', () => ({
  useRouteContext: () => ({ engineClient: { request } }),
  useNavigate: () => navigate,
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it('I01 旧项目缺省画风可编辑，题材值保持唯一来源', () => {
  function Fields() {
    const [profile, setProfile] = useState<ProjectProfile>({
      form: null,
      medium: null,
      aspect: null,
      genres: ['悬疑'],
    });
    return (
      <>
        <ProfileFields value={profile} onChange={setProfile} />
        <output>{JSON.stringify(profile)}</output>
      </>
    );
  }
  render(<Fields />);
  fireEvent.change(screen.getByLabelText('共享画风'), { target: { value: '冷色写实' } });
  expect(screen.getByRole('status').textContent).toContain('"style":"冷色写实"');
  expect(screen.getByRole('status').textContent).toContain('"genres":["悬疑"]');
});
it('I01 时长只接受非负整数，失败保留标题和时长，可重试', async () => {
  request.mockRejectedValueOnce(new Error('写入失败')).mockResolvedValue({ id: 'e' });
  const close = vi.fn();
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}
    >
      <EpisodeDialog projectId="p" episodes={[]} action={{ kind: 'create' }} onClose={close} />
    </QueryClientProvider>,
  );
  const duration = screen.getByLabelText('单集时长（秒，0 表示未填写）');
  fireEvent.change(duration, { target: { value: '-1' } });
  expect(screen.getByRole('button', { name: '确认' }).hasAttribute('disabled')).toBe(true);
  fireEvent.change(duration, { target: { value: '1.5' } });
  expect(screen.getByRole('button', { name: '确认' }).hasAttribute('disabled')).toBe(true);
  fireEvent.change(duration, { target: { value: '780' } });
  fireEvent.change(screen.getByLabelText('标题（选填）'), { target: { value: '陌生来客' } });
  fireEvent.click(screen.getByRole('button', { name: '确认' }));
  await screen.findByText('写入失败');
  expect((duration as HTMLInputElement).value).toBe('780');
  expect(close).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '确认' }));
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(request).toHaveBeenLastCalledWith('/projects/p/episodes', expect.anything(), {
    method: 'POST',
    body: { number: 1, title: '陌生来客', duration_sec: 780 },
  });
});
