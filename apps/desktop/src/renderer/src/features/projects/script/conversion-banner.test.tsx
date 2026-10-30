import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { ScriptResult } from '@frame-loom/contracts';
import type { EngineClient } from '@/lib/engine-client';
import { ConversionBanner } from './conversion-banner';
afterEach(cleanup);
const initial: ScriptResult = {
  format: 'frame-loom-script',
  formatVersion: 1,
  id: crypto.randomUUID(),
  revision: 2,
  source: null,
  pendingImport: { text: '原文', importedAt: new Date().toISOString() },
  convertedAt: null,
  document: { schemaVersion: 2, preface: '', appendix: '', blocks: [] },
  conversion: {
    status: 'running',
    stage: 'classify',
    done: 1,
    total: 2,
    warnings: [],
    error: null,
    result: null,
  },
};
it('转换阶段、取消和完成结果警告', async () => {
  const request = vi.fn().mockResolvedValue({ saved: true });
  const props = {
    client: { request } as unknown as EngineClient,
    projectId: 'p',
    episodeId: 'e',
    revision: () => 2,
    flush: vi.fn().mockResolvedValue(true),
    changed: vi.fn().mockResolvedValue(undefined),
    edit: vi.fn(),
    view: vi.fn(),
    openedAt: 0,
  };
  const { rerender } = render(<ConversionBanner {...props} record={initial} />);
  expect(screen.getByText('识别段落类型 · 已处理 1 / 2 批')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '取消转换' }));
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith(expect.stringContaining('/cancel'), expect.anything(), {
      method: 'POST',
    }),
  );
  rerender(
    <ConversionBanner
      {...props}
      record={{
        ...initial,
        convertedAt: new Date().toISOString(),
        pendingImport: null,
        conversion: {
          ...initial.conversion!,
          status: 'succeeded',
          result: { scenes: 7, blocks: 60, unsure: 3, addedElements: 10 },
          warnings: ['没有模型'],
        },
      }}
    />,
  );
  expect(screen.getByText('已识别 7 场、60 段，新增 10 个元素')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '查看' }));
  expect(props.view).toHaveBeenCalled();
  expect(screen.getByText('部分内容按规则识别')).toBeTruthy();
});
it('继续不带 text，丢弃使用 DELETE', async () => {
  const request = vi.fn().mockResolvedValue({});
  const props = {
    client: { request } as unknown as EngineClient,
    projectId: 'p',
    episodeId: 'e',
    revision: () => 2,
    flush: vi.fn().mockResolvedValue(true),
    changed: vi.fn().mockResolvedValue(undefined),
    edit: vi.fn(),
    view: vi.fn(),
    openedAt: 0,
  };
  render(<ConversionBanner {...props} record={{ ...initial, conversion: null }} />);
  fireEvent.click(screen.getByRole('button', { name: '继续转换' }));
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith(expect.stringContaining('/import'), expect.anything(), {
      method: 'POST',
      body: { revision: 2 },
    }),
  );
  await waitFor(() =>
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '丢弃' }).disabled).toBe(false),
  );
  fireEvent.click(screen.getByRole('button', { name: '丢弃' }));
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith(expect.stringContaining('/import'), expect.anything(), {
      method: 'DELETE',
    }),
  );
});
