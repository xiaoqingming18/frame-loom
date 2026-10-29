import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { Editor } from '@tiptap/core';
import type { ScriptDocument } from '@frame-loom/contracts';
import { ScriptEditor } from './script-editor';
afterEach(cleanup);
it('渲染类型、切换时间、切换类型及撤销重做', async () => {
  const changed = vi.fn<(document: ScriptDocument) => void>();
  render(
    <ScriptEditor
      document={{
        schemaVersion: 1,
        blocks: [{ id: 'a', type: 'scene', text: '天台', attrs: { time: 'day', space: 'ext' } }],
      }}
      onChange={changed}
      onError={vi.fn()}
    />,
  );
  await screen.findByRole('textbox', { name: '剧本编辑区' });
  expect(screen.getByText('天台').getAttribute('data-block-type')).toBe('scene');
  expect(screen.getByRole<HTMLButtonElement>('button', { name: '撤销' }).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '切换场景时间' }));
  expect(changed.mock.lastCall?.[0].blocks[0].attrs).toEqual({ time: 'night', space: 'ext' });
  fireEvent.change(screen.getByLabelText('段落类型'), { target: { value: 'dialogue' } });
  expect(changed.mock.lastCall?.[0].blocks[0].type).toBe('dialogue');
  fireEvent.click(screen.getByRole('button', { name: '撤销' }));
  await waitFor(() =>
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '重做' }).disabled).toBe(false),
  );
});
it('粘贴三行生成三个动作段', async () => {
  let editor: Editor | null = null;
  const changed = vi.fn<(document: ScriptDocument) => void>();
  render(
    <ScriptEditor
      document={{ schemaVersion: 1, blocks: [{ id: 'a', type: 'scene', text: '' }] }}
      onChange={changed}
      onError={vi.fn()}
      onEditor={(value) => {
        editor = value;
      }}
    />,
  );
  const textbox = await screen.findByRole('textbox', { name: '剧本编辑区' });
  await waitFor(() => expect(editor).not.toBeNull());
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: { getData: () => '一\n二\n三' } });
  fireEvent(textbox, event);
  expect(changed.mock.lastCall?.[0].blocks.map((block) => block.text)).toEqual(['一', '二', '三']);
});
