import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ProjectTag, ProjectTagUsage } from '@frame-loom/contracts';
import { TagDeleteDialog } from './tag-delete-dialog';

afterEach(cleanup);

const projectId = '00000000-0000-4000-8000-000000000001';
const tag = ProjectTag.parse({ id: 'old', name: '旧标签', color: 'blue', builtin: false });
const other = ProjectTag.parse({ id: 'new', name: '新标签', color: 'green', builtin: false });
const usages = ProjectTagUsage.array().parse([
  {
    pageId: projectId,
    pageName: '第一页',
    nodeId: 'one',
    nodeType: 'image',
    title: '图片',
    locked: true,
    thumbnailSha256: 'a'.repeat(64),
  },
  {
    pageId: projectId,
    pageName: '第二页',
    nodeId: 'two',
    nodeType: 'video',
    title: '视频',
    locked: false,
    thumbnailSha256: null,
  },
]);

function setup(overrides: Partial<Parameters<typeof TagDeleteDialog>[0]> = {}) {
  const props = {
    projectId,
    tag,
    tags: [tag, other],
    usages,
    loading: false,
    error: null,
    onCancel: vi.fn(),
    onConfirm: vi.fn(),
    ...overrides,
  };
  return { ...render(<TagDeleteDialog {...props} />), props };
}

it('逐行改派全部选完才可删除，锁定节点仍可选择并显示可访问图标与缩略图', () => {
  const { props } = setup();
  const remove = screen.getByRole<HTMLButtonElement>('button', { name: '删除标签' });
  expect(remove.disabled).toBe(true);
  expect(screen.getByRole('img', { name: '已锁定' })).toBeTruthy();
  expect(document.querySelector('img')?.getAttribute('src')).toBe(
    `frame-project://${projectId}/media/${'a'.repeat(64)}`,
  );
  expect(screen.getByText('第一页')).toBeTruthy();
  expect(screen.queryByRole('option', { name: '旧标签' })).toBeNull();
  fireEvent.change(screen.getByRole('combobox', { name: '图片的改派标签' }), {
    target: { value: 'new' },
  });
  expect(remove.disabled).toBe(true);
  fireEvent.change(screen.getByRole('combobox', { name: '视频的改派标签' }), {
    target: { value: '__none' },
  });
  expect(remove.disabled).toBe(false);
  fireEvent.click(remove);
  expect(props.onConfirm).toHaveBeenCalledWith([
    { pageId: projectId, nodeId: 'one', tagId: 'new' },
    { pageId: projectId, nodeId: 'two', tagId: null },
  ]);
});

it('全部改为覆盖每行；刷新后的错误提示不阻止重新选择并重试', () => {
  const { props } = setup({ error: '标签引用已变化，请重新选择。' });
  expect(screen.getByRole('alert').textContent).toContain('引用已变化');
  const remove = screen.getByRole<HTMLButtonElement>('button', { name: '删除标签' });
  expect(remove.disabled).toBe(true);
  fireEvent.change(screen.getByRole('combobox', { name: '全部改为' }), {
    target: { value: '__none' },
  });
  expect(remove.disabled).toBe(false);
  fireEvent.click(remove);
  expect(props.onConfirm).toHaveBeenCalledWith(
    usages.map(({ pageId, nodeId }) => ({ pageId, nodeId, tagId: null })),
  );
});

it('无引用时提示不可恢复，取消不提交', () => {
  const { props } = setup({ usages: [] });
  expect(screen.getByText('删除后不可恢复。')).toBeTruthy();
  expect(screen.getByRole<HTMLButtonElement>('button', { name: '删除标签' }).disabled).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  expect(props.onCancel).toHaveBeenCalledOnce();
  expect(props.onConfirm).not.toHaveBeenCalled();
});

it('提交中禁用改派、重复提交与取消，也不响应 Escape', () => {
  const { props } = setup({ loading: true });
  for (const select of screen.getAllByRole('combobox'))
    expect((select as HTMLSelectElement).disabled).toBe(true);
  expect(screen.getByRole<HTMLButtonElement>('button', { name: '删除标签' }).disabled).toBe(true);
  expect(screen.getByRole<HTMLButtonElement>('button', { name: '取消' }).disabled).toBe(true);
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
  expect(props.onCancel).not.toHaveBeenCalled();
});
