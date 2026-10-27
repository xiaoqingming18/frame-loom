import { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Dialog, DialogContent, DialogTitle } from '@frame-loom/ui/components/dialog';
import { BUILTIN_TAGS, type ProjectTag } from '@frame-loom/contracts';
import { CanvasContext } from '../context';
import { createCanvasStore } from '../store/store';
import { createBuiltinRegistry } from '../nodes/builtin';
import { doc, media } from '../test-utils';
import { TagPopover, TagPopoverContent } from './tag-popover';

const custom: ProjectTag = { id: 'custom', name: '自定义', color: 'cyan', builtin: false };
afterEach(cleanup);
function setup(nodes = [media('a'), media('b', 'video')], popover = false) {
  const store = createCanvasStore(doc(nodes));
  store.getState().setTags([BUILTIN_TAGS[0], custom]);
  store.getState().select(nodes.map((node) => node.id));
  const api = { list: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn() };
  const close = vi.fn();
  render(
    <CanvasContext.Provider
      value={{
        store,
        registry: createBuiltinRegistry(),
        host: {
          media: { upload: vi.fn(), url: (hash) => hash },
          tags: api,
        },
      }}
    >
      {popover ? (
        <TagPopover at={{ x: 0, y: 0 }} onClose={close} />
      ) : (
        <TagPopoverContent onClose={close} />
      )}
    </CanvasContext.Provider>,
  );
  return { store, api, close };
}

it('批量打标签显示一致选中态，移除可撤销且不改变锁定节点', () => {
  const { store, close } = setup([
    media('a', 'image', { tagId: custom.id }),
    media('b', 'video', { tagId: custom.id }),
    media('locked', 'image', { locked: true }),
  ]);
  expect(screen.getByRole('button', { name: custom.name }).getAttribute('aria-pressed')).toBe(
    'true',
  );
  fireEvent.click(screen.getByRole('button', { name: '移除标签' }));
  expect(store.getState().document.nodes.every((node) => !node.tagId)).toBe(true);
  expect(store.getState().past).toHaveLength(1);
  expect(close).toHaveBeenCalledOnce();
  act(() => store.getState().undo());
  fireEvent.click(screen.getByRole('button', { name: '道具' }));
  expect(store.getState().document.nodes.map((node) => node.tagId)).toEqual([
    'builtin-prop',
    'builtin-prop',
    undefined,
  ]);
});

it('点击已选中的标签仍关闭卡片，不新增撤销历史', () => {
  const { store, close } = setup([media('a', 'image', { tagId: custom.id })]);
  fireEvent.click(screen.getByRole('button', { name: custom.name }));
  expect(close).toHaveBeenCalledOnce();
  expect(store.getState().past).toHaveLength(0);
  expect(store.getState().document.nodes[0].tagId).toBe(custom.id);
});

it('混合选区不显示选中态，无标签时不能移除，内置无编辑入口，管理按钮键盘可达', () => {
  setup([media('a', 'image', { tagId: custom.id }), media('b')]);
  expect(screen.getByRole('button', { name: custom.name }).getAttribute('aria-pressed')).toBe(
    'false',
  );
  expect(screen.queryByRole('button', { name: '编辑标签 道具' })).toBeNull();
  const edit = screen.getByRole('button', { name: '编辑标签 自定义' });
  edit.focus();
  expect(document.activeElement).toBe(edit);
  fireEvent.click(edit);
  expect(screen.getByRole('textbox', { name: '编辑标签名' })).toBe(document.activeElement);
  expect(screen.getAllByRole('button', { name: '青色' })[0].getAttribute('aria-pressed')).toBe(
    'true',
  );
});

it('新增名称冲突就地显示，新增改色与编辑使用宿主返回列表', async () => {
  const { api, store } = setup();
  expect(screen.getByRole<HTMLButtonElement>('button', { name: '移除标签' }).disabled).toBe(true);
  fireEvent.change(screen.getByRole('textbox', { name: '标签名' }), { target: { value: '道具' } });
  fireEvent.click(screen.getByRole('button', { name: '添加' }));
  expect(screen.getByRole('alert').textContent).toBe('标签名已存在');
  expect(api.create).not.toHaveBeenCalled();
  const added = { ...custom, id: 'new', name: '新标签', color: 'red' as const };
  api.create.mockResolvedValue([added]);
  fireEvent.change(screen.getByRole('textbox', { name: '标签名' }), {
    target: { value: added.name },
  });
  fireEvent.click(screen.getByRole('button', { name: '选择标签颜色' }));
  fireEvent.click(screen.getByRole('button', { name: '红色' }));
  await act(async () => {
    await Promise.resolve();
    fireEvent.click(screen.getByRole('button', { name: '添加' }));
  });
  expect(api.create).toHaveBeenCalledWith({ name: added.name, color: 'red' });
  expect(store.getState().tags).toEqual([added]);
  fireEvent.click(screen.getByRole('button', { name: '编辑标签 新标签' }));
  api.update.mockResolvedValue([{ ...added, name: '改名' }]);
  fireEvent.change(screen.getByRole('textbox', { name: '编辑标签名' }), {
    target: { value: '改名' },
  });
  await act(async () => {
    await Promise.resolve();
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
  });
  expect(api.update).toHaveBeenCalledWith('new', { name: '改名', color: 'red' });
});

it('删除取消保留列表，失败就地显示，成功替换列表', async () => {
  const { api, store } = setup();
  const previous = store.getState().tags;
  api.remove
    .mockResolvedValueOnce(null)
    .mockRejectedValueOnce(new Error('删除失败'))
    .mockResolvedValueOnce([]);
  const remove = screen.getByRole('button', { name: '删除标签 道具' });
  await act(async () => {
    await Promise.resolve();
    fireEvent.click(remove);
  });
  expect(store.getState().tags).toBe(previous);
  await act(async () => {
    await Promise.resolve();
    fireEvent.click(remove);
  });
  expect(screen.getByRole('alert').textContent).toBe('删除失败');
  await act(async () => {
    await Promise.resolve();
    fireEvent.click(remove);
  });
  expect(store.getState().tags).toEqual([]);
});

it('删除打开宿主模态框时，卡片关闭不抢走弹窗焦点', async () => {
  const store = createCanvasStore(doc([media('a')]));
  store.getState().setTags([custom]);
  function Harness() {
    const [popover, setPopover] = useState(true);
    const [dialog, setDialog] = useState(false);
    return (
      <CanvasContext.Provider
        value={{
          store,
          registry: createBuiltinRegistry(),
          host: {
            media: { upload: vi.fn(), url: (hash) => hash },
            tags: {
              list: vi.fn(),
              create: vi.fn(),
              update: vi.fn(),
              remove: () => {
                setDialog(true);
                return new Promise(() => {});
              },
            },
          },
        }}
      >
        <div className="frame-loom-canvas" tabIndex={0} />
        {popover && <TagPopover at={{ x: 0, y: 0 }} onClose={() => setPopover(false)} />}
        <Dialog open={dialog} onOpenChange={setDialog}>
          <DialogContent aria-describedby={undefined}>
            <DialogTitle>删除标签引用</DialogTitle>
            <button>确认删除</button>
          </DialogContent>
        </Dialog>
      </CanvasContext.Provider>
    );
  }
  render(<Harness />);
  fireEvent.click(screen.getByRole('button', { name: '删除标签 自定义' }));
  await waitFor(() => {
    const dialog = screen.getByRole('dialog', { name: '删除标签引用' });
    expect(dialog.contains(document.activeElement)).toBe(true);
  });
  expect(screen.queryByRole('dialog', { name: '画布标签' })).toBeNull();
});

it('卡片提供对话框语义，Esc 关闭', () => {
  const { close } = setup(undefined, true);
  expect(screen.getByRole('dialog', { name: '画布标签' })).toBeDefined();
  fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
  expect(close).toHaveBeenCalledOnce();
});
