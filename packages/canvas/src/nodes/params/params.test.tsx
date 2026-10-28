import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { getProtocol, resolveImageSize, type ImageCap } from '@frame-loom/contracts';
import { TooltipProvider } from '@frame-loom/ui/components/tooltip';
import { ImageParams } from './image-params';
import { VideoParams } from './video-params';

afterEach(cleanup);

vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

it('图像只列启用档位及已勾选比例，像素使用共享计算', () => {
  const protocol = getProtocol('openai-images')!;
  const cap = structuredClone(protocol.templates.image!);
  const tier = cap.size.tiers.find((tier) => tier.enabled)!;
  tier.ratios = tier.ratios.slice(0, 1);
  cap.size.tiers.forEach((entry) => {
    entry.enabled = entry === tier;
  });
  const params = { tier: tier.name, aspectRatio: tier.ratios[0].ratio };
  const resolved = resolveImageSize(cap, params, false);
  render(
    <ImageParams
      capability={cap}
      protocol={protocol}
      params={params}
      inputs={[]}
      onChange={vi.fn()}
      disabled={false}
    />,
  );
  expect(screen.getAllByRole('radio', { name: /^档位 / })).toHaveLength(1);
  expect(screen.getAllByRole('radio', { name: /^比例 / })).toHaveLength(1);
  expect(screen.getByLabelText('预计像素').textContent).toBe(
    `${resolved.width}×${resolved.height}`,
  );
});

it('自定义尺寸超限就地报错，画质滑块只输出能力卡取值', () => {
  const protocol = getProtocol('openai-images')!;
  const cap: ImageCap = structuredClone(protocol.templates.image!);
  cap.quality = { values: ['low', 'high'], default: 'low' };
  const onChange = vi.fn();
  render(
    <ImageParams
      capability={cap}
      protocol={protocol}
      params={{ width: 1, height: 1 }}
      inputs={[]}
      onChange={onChange}
      disabled={false}
    />,
  );
  expect(screen.getByRole('alert').textContent).toBeTruthy();
  expect(screen.getByRole('slider', { name: '画质' }).getAttribute('aria-valuemax')).toBe('1');
  fireEvent.keyDown(screen.getByRole('slider', { name: '画质' }), { key: 'End' });
  expect(onChange).toHaveBeenLastCalledWith({ width: 1, height: 1, quality: 'high' });
});

it('服务商决定尺寸时不伪造像素', () => {
  const protocol = structuredClone(getProtocol('openai-images')!);
  protocol.sizeRule = { kind: 'provider' };
  const cap = structuredClone(protocol.templates.image!);
  cap.size.wire = 'tier';
  const tier = cap.size.tiers.find((tier) => tier.enabled)!;
  render(
    <ImageParams
      capability={cap}
      protocol={protocol}
      params={{ tier: tier.name, aspectRatio: tier.ratios[0].ratio }}
      inputs={[]}
      onChange={vi.fn()}
      disabled={false}
    />,
  );
  expect(screen.getByLabelText('预计像素').textContent).toBe('由服务商决定');
});

it('视频规则锁定选项有说明，固定声音只读', () => {
  const protocol = getProtocol('ark-seedance')!;
  const cap = structuredClone(protocol.templates.video!);
  cap.audio = { mode: 'on' };
  render(
    <TooltipProvider>
      <VideoParams
        capability={cap}
        protocol={protocol}
        mode="first_last"
        inputs={[
          { role: 'first_frame', kind: 'image', order: 0, sha256: 'a'.repeat(64) },
          { role: 'last_frame', kind: 'image', order: 1, sha256: 'b'.repeat(64) },
        ]}
        params={{}}
        onChange={vi.fn()}
        disabled={false}
      />
    </TooltipProvider>,
  );
  const locked = screen
    .getAllByRole('radio', { name: /^比例 / })
    .filter((item) => item.hasAttribute('disabled'));
  expect(locked.length).toBeGreaterThan(0);
  expect(locked[0].getAttribute('aria-describedby')).toBeTruthy();
  expect(screen.getByText('声音：固定有声')).toBeTruthy();
  expect(screen.queryByRole('group', { name: '声音' })).toBeNull();
});

it('MiniMax 文生方式禁用 adaptive，原因可读', () => {
  const protocol = getProtocol('minimax-video-v2')!;
  const cap = structuredClone(protocol.templates.video!);
  render(
    <TooltipProvider>
      <VideoParams
        capability={cap}
        protocol={protocol}
        mode="t2v"
        inputs={[]}
        params={{}}
        onChange={vi.fn()}
        disabled={false}
      />
    </TooltipProvider>,
  );
  expect(screen.getByRole<HTMLButtonElement>('radio', { name: '比例 adaptive' }).disabled).toBe(
    true,
  );
  expect(
    screen.getByRole('radio', { name: '比例 adaptive' }).getAttribute('aria-describedby'),
  ).toBeTruthy();
});
