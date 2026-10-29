import { Extension } from '@tiptap/core';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Volume2, StickyNote } from 'lucide-react';
import { Plugin } from '@tiptap/pm/state';
import type { Node } from '@tiptap/pm/model';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { SceneAttrs, CharacterAttrs } from '@frame-loom/contracts';

const timeLabels = { day: '日', night: '夜', dawn: '晨', dusk: '昏' };
const spaceLabels = { int: '内', ext: '外', intext: '内外' };
const iconRoots = new WeakMap<HTMLElement, Root>();
export const SceneChips = Extension.create<{ episodeNumber: number }>({
  name: 'sceneChips',
  addOptions: () => ({ episodeNumber: 1 }),
  addProseMirrorPlugins() {
    const episodeNumber = this.options.episodeNumber;
    const signature = (doc: Node) => {
      const values: unknown[] = [];
      doc.forEach((node) => {
        if (['scene', 'character', 'sound', 'text', 'note'].includes(node.attrs.type as string))
          values.push([node.attrs.id, node.attrs.type, node.attrs.attrs]);
      });
      return JSON.stringify(values);
    };
    function build(doc: Node) {
      const decorations: Decoration[] = [];
      let scene = 0;
      doc.forEach((node, pos) => {
        if (node.attrs.type === 'scene') {
          scene++;
          const number = scene;
          const attrs = node.attrs.attrs
            ? (JSON.parse(node.attrs.attrs as string) as SceneAttrs)
            : { time: null, space: null };
          decorations.push(
            Decoration.widget(
              pos + 1,
              (view) => {
                const container = document.createElement('span');
                container.className = 'script-scene-chips';
                container.contentEditable = 'false';
                const badge = document.createElement('span');
                badge.textContent = `${episodeNumber}-${number}`;
                container.append(badge);
                for (const field of ['time', 'space'] as const) {
                  const button = document.createElement('button');
                  button.type = 'button';
                  button.setAttribute(
                    'aria-label',
                    field === 'time' ? '切换场景时间' : '切换场景内外',
                  );
                  button.textContent =
                    field === 'time'
                      ? attrs.time
                        ? timeLabels[attrs.time]
                        : '时间'
                      : attrs.space
                        ? spaceLabels[attrs.space]
                        : '内外';
                  button.addEventListener('mousedown', (event) => event.preventDefault());
                  button.addEventListener('click', () => {
                    if (!view.editable) return;
                    let currentPos = -1;
                    view.state.doc.forEach((candidate, position) => {
                      if (candidate.attrs.id === node.attrs.id) currentPos = position;
                    });
                    const current = currentPos < 0 ? null : view.state.doc.nodeAt(currentPos);
                    if (!current) return;
                    const values =
                      field === 'time'
                        ? [null, 'day', 'night', 'dawn', 'dusk']
                        : [null, 'int', 'ext', 'intext'];
                    const next = {
                      ...attrs,
                      [field]: values[(values.indexOf(attrs[field]) + 1) % values.length],
                    };
                    view.dispatch(
                      view.state.tr.setNodeMarkup(currentPos, undefined, {
                        ...current.attrs,
                        attrs: JSON.stringify(next),
                      }),
                    );
                  });
                  container.append(button);
                }
                return container;
              },
              { key: `scene-${node.attrs.id}-${node.attrs.attrs}-${number}`, side: -1 },
            ),
          );
        }
        if (node.attrs.type === 'character' && node.attrs.attrs) {
          const { delivery } = JSON.parse(node.attrs.attrs as string) as CharacterAttrs;
          if (delivery)
            decorations.push(
              Decoration.widget(
                pos + node.nodeSize - 1,
                () => {
                  const span = document.createElement('span');
                  span.className = 'script-chip';
                  span.textContent = delivery.toUpperCase();
                  return span;
                },
                { key: `${node.attrs.id}-${delivery}` },
              ),
            );
        }
        if (node.attrs.type === 'sound' || node.attrs.type === 'text' || node.attrs.type === 'note')
          decorations.push(
            Decoration.widget(
              pos + 1,
              () => {
                const span = document.createElement('span');
                if (node.attrs.type === 'text') span.textContent = '字幕 ';
                else {
                  const root = createRoot(span);
                  iconRoots.set(span, root);
                  root.render(
                    createElement(node.attrs.type === 'sound' ? Volume2 : StickyNote, {
                      size: 14,
                      className: 'inline mr-1',
                    }),
                  );
                }
                span.setAttribute('aria-hidden', 'true');
                return span;
              },
              {
                key: `prefix-${node.attrs.id}-${node.attrs.type}`,
                side: -1,
                destroy: (node) => {
                  if (node instanceof HTMLElement) {
                    const root = iconRoots.get(node);
                    if (root) queueMicrotask(() => root.unmount());
                  }
                },
              },
            ),
          );
      });
      return DecorationSet.create(doc, decorations);
    }
    return [
      new Plugin<{ signature: string; decorations: DecorationSet }>({
        state: {
          init: (_, state) => ({ signature: signature(state.doc), decorations: build(state.doc) }),
          apply(tr, previous) {
            if (!tr.docChanged) return previous;
            const next = signature(tr.doc);
            const mapped = previous.decorations.map(tr.mapping, tr.doc);
            const intact = mapped.find().length === previous.decorations.find().length;
            return {
              signature: next,
              decorations: next === previous.signature && intact ? mapped : build(tr.doc),
            };
          },
        },
        props: {
          decorations(state) {
            return this.getState(state)?.decorations;
          },
        },
      }),
    ];
  },
});
