import { createServer } from 'node:http';
import { z } from 'zod';
export const shortSource = '## 便利店 夜 内\n△ 老陈站在门外。\n林夏（疑惑）：您认识我？';
export const longSource = [
  '## 便利店 夜 内',
  ...Array.from({ length: 160 }, () => '△ 老陈站在门外。'),
].join('\n');
const Input = z.object({
  mode: z.string(),
  batchId: z.string(),
  responsible: z.object({ start: z.number(), end: z.number() }),
  context: z.object({ start: z.number(), end: z.number() }).optional(),
  continuation: z.boolean().optional(),
  source: z.array(z.object({ id: z.number(), text: z.string() })),
});
export async function scriptModel(long = false) {
  const requests: z.infer<typeof Input>[] = [];
  let fail = false;
  let blocked: Promise<void> | undefined;
  let release: (() => void) | undefined;
  const server = createServer((req, res) => {
    void (async () => {
      let body = '';
      for await (const chunk of req) body += String(chunk);
      const wire = z
        .object({ messages: z.array(z.object({ role: z.string(), content: z.string() })) })
        .parse(JSON.parse(body));
      const input = Input.parse(JSON.parse(wire.messages.find((m) => m.role === 'user')!.content));
      requests.push(input);
      await blocked;
      let output: unknown;
      if (input.mode === 'locate')
        output = {
          batchId: input.batchId,
          responsible: input.responsible,
          context: input.context,
          parts: [
            {
              range: input.responsible,
              kind: 'scene',
              sceneKey: 0,
              continuation: input.responsible.start !== 0,
              reason: '',
            },
          ],
        };
      else {
        const beats: unknown[] = [],
          mappings: unknown[] = [];
        for (const unit of input.source) {
          if (unit.id === 0) {
            mappings.push({ unit: 0, start: 3, end: 6, path: 'location' });
            continue;
          }
          const index = beats.length;
          if (!long && unit.id === 2) {
            beats.push({ type: 'dialogue', speaker: '林夏', emotion: '疑惑', line: '您认识我？' });
            mappings.push(
              { unit: 2, start: 0, end: 2, path: `beats.${index}.speaker` },
              { unit: 2, start: 3, end: 5, path: `beats.${index}.emotion` },
              { unit: 2, start: 7, end: 12, path: `beats.${index}.line` },
            );
          } else {
            beats.push({ type: 'action', content: '老陈站在门外。' });
            mappings.push({ unit: unit.id, start: 2, end: 9, path: `beats.${index}.content` });
          }
        }
        output = {
          batchId: input.batchId,
          responsible: input.responsible,
          sceneKey: 0,
          continuation: input.continuation,
          scene: {
            location: '便利店',
            time_of_day: '夜',
            interior: true,
            characters: long ? ['老陈'] : ['老陈', '林夏'],
            atmosphere: '',
            beats,
          },
          mappings,
        };
      }
      const content =
        fail && input.mode === 'scene' && input.batchId === 'content-1'
          ? '{'
          : JSON.stringify(output);
      res
        .writeHead(200, { 'Content-Type': 'text/event-stream' })
        .end(
          `data: ${JSON.stringify({ id: 'script', choices: [{ index: 0, delta: { content }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ id: 'script', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`,
        );
    })().catch((error) => {
      res.writeHead(500).end(String(error));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('模拟模型启动失败');
  return {
    origin: `http://127.0.0.1:${address.port}`,
    requests,
    setFail: (value: boolean) => {
      fail = value;
    },
    pause() {
      blocked = new Promise<void>((resolve) => {
        release = resolve;
      });
      return () => {
        release?.();
        blocked = undefined;
      };
    },
    async close() {
      release?.();
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}
