import { Extension } from '@tiptap/core';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Volume2, StickyNote } from 'lucide-react';
import { Plugin } from '@tiptap/pm/state';
import type { Node } from '@tiptap/pm/model';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import {
  SPACE_LABELS,
  TIME_LABELS,
  type SceneAttrs,
  type CharacterAttrs,
  type TagAttrs,
} from '@frame-loom/contracts';

const timeLabels = TIME_LABELS;
const spaceLabels = SPACE_LABELS;
const iconRoots = new WeakMap<HTMLElement, Root>();
export const SceneChips = Extension.create<{ episodeNumber: number }>({
  name: 'sceneChips',
  addOptions: () => ({ episodeNumber: 1 }),
  addProseMirrorPlugins() {
    const episodeNumber = this.options.episodeNumber;
    const signature = (doc: Node) => {
      const values: unknown[] = [];
      doc.forEach((node) => {
        if (
          ['scene', 'character', 'sound', 'production', 'text', 'note'].includes(
            node.attrs.type as string,
          )
        )
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
            : { time: null, space: null, timeText: null, note: null, timecode: null };
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
                for (const field of ['space'] as const) {
                  const button = document.createElement('button');
                  button.type = 'button';
                  button.setAttribute('aria-label', '切换场景内外');
                  button.textContent = attrs.space ? spaceLabels[attrs.space] : '内外';
                  button.addEventListener('mousedown', (event) => event.preventDefault());
                  button.addEventListener('click', () => {
                    if (!view.editable) return;
                    let currentPos = -1;
                    view.state.doc.forEach((candidate, position) => {
                      if (candidate.attrs.id === node.attrs.id) currentPos = position;
                    });
                    const current = currentPos < 0 ? null : view.state.doc.nodeAt(currentPos);
                    if (!current) return;
                    const values = [null, 'int', 'ext', 'intext'];
                    const next = {
                      ...attrs,
                      timeText: null,
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
          decorations.push(
            Decoration.widget(
              pos + node.nodeSize - 1,
              (view) => {
                const container = document.createElement('span');
                container.className = 'script-scene-tail';
                container.contentEditable = 'false';
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'script-chip';
                button.setAttribute('aria-label', '切换场景时间');
                button.textContent =
                  attrs.timeText ?? (attrs.time ? timeLabels[attrs.time] : '时间');
                button.addEventListener('mousedown', (event) => event.preventDefault());
                button.addEventListener('click', () => {
                  if (!view.editable) return;
                  let position = -1;
                  view.state.doc.forEach((current, pos) => {
                    if (current.attrs.id === node.attrs.id) position = pos;
                  });
                  if (position < 0) return;
                  const current = view.state.doc.nodeAt(position)!;
                  const values: SceneAttrs['time'][] = [null, 'day', 'night', 'dawn', 'dusk'];
                  view.dispatch(
                    view.state.tr.setNodeMarkup(position, undefined, {
                      ...current.attrs,
                      attrs: JSON.stringify({
                        ...attrs,
                        timeText: null,
                        time: values[(values.indexOf(attrs.time) + 1) % values.length],
                      }),
                    }),
                  );
                });
                container.append(button);
                for (const [text, className] of [
                  [attrs.note, 'script-chip'],
                  [attrs.timecode, 'script-chip font-mono'],
                ])
                  if (text) {
                    const span = document.createElement('span');
                    span.className = className!;
                    span.textContent = text;
                    container.append(span);
                  }
                return container;
              },
              { key: `tail-${node.attrs.id}-${node.attrs.attrs}` },
            ),
          );
        }
        if (node.attrs.type === 'character' && node.attrs.attrs) {
          const { delivery, extension } = JSON.parse(node.attrs.attrs as string) as CharacterAttrs;
          if (delivery || extension)
            decorations.push(
              Decoration.widget(
                pos + node.nodeSize - 1,
                () => {
                  const span = document.createElement('span');
                  span.className = 'script-chip';
                  span.textContent = [delivery?.toUpperCase(), extension]
                    .filter(Boolean)
                    .join(' · ');
                  return span;
                },
                { key: `${node.attrs.id}-${delivery}-${extension}` },
              ),
            );
        }
        if (
          node.attrs.type === 'sound' ||
          node.attrs.type === 'production' ||
          node.attrs.type === 'text' ||
          node.attrs.type === 'note'
        )
          decorations.push(
            Decoration.widget(
              pos + 1,
              () => {
                const span = document.createElement('span');
                if (node.attrs.type === 'text') span.textContent = '字幕 ';
                else if (node.attrs.type === 'production') {
                  span.className = 'script-production-label';
                  span.textContent = (JSON.parse(node.attrs.attrs as string) as TagAttrs).label;
                } else {
                  const root = createRoot(span);
                  iconRoots.set(span, root);
                  root.render(
                    createElement(
                      'span',
                      null,
                      createElement(node.attrs.type === 'sound' ? Volume2 : StickyNote, {
                        size: 14,
                        className: 'inline mr-1',
                      }),
                      node.attrs.type === 'sound'
                        ? (JSON.parse(node.attrs.attrs as string) as TagAttrs).label
                        : null,
                    ),
                  );
                }
                span.setAttribute('aria-hidden', 'true');
                return span;
              },
              {
                key: `prefix-${node.attrs.id}-${node.attrs.type}-${node.attrs.attrs}`,
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
