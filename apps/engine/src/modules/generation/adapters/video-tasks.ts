import { z } from 'zod';
import type { GenerationRequest } from '@frame-loom/contracts';
import { imageResponse } from './image-response.js';
import {
  GenerationFailure,
  type AdapterContext,
  type AdapterResult,
  type GenerationAdapter,
} from './types.js';

const Task = z.object({
  id: z.string().min(1),
  status: z.string(),
  content: z.object({ video_url: z.url().optional(), url: z.url().optional() }).optional(),
  error: z
    .object({ code: z.union([z.string(), z.number()]).optional() })
    .nullable()
    .optional(),
  usage: z.unknown().optional(),
});
function invalid(): never {
  throw new GenerationFailure(
    'upstream',
    'INVALID_RESPONSE',
    '视频任务响应格式无效，无法确认结果',
    false,
    true,
  );
}
function parseTask(value: unknown, openai = false): AdapterResult {
  const parsed = Task.safeParse(value);
  if (!parsed.success) return invalid();
  const task = parsed.data;
  if (['queued', 'running', 'in_progress'].includes(task.status))
    return { status: 'running', remoteTaskId: task.id, remoteStatus: task.status };
  if (['succeeded', 'completed'].includes(task.status)) {
    const url = task.content?.video_url ?? task.content?.url;
    if (!openai && !url) return invalid();
    return {
      status: 'succeeded',
      outputs: [
        openai ? { mime: 'video/mp4', providerContent: task.id } : { mime: 'video/mp4', url },
      ],
      usage: task.usage,
    };
  }
  if (['failed', 'cancelled', 'expired'].includes(task.status)) {
    const raw = String(task.error?.code ?? task.status);
    const code = /^[\w.-]{1,100}$/.test(raw) ? raw : 'VIDEO_FAILED';
    const moderation = /1026|moderation|safety|content|sensitive|risk|blocked/i.test(code);
    return {
      status: 'failed',
      category: moderation ? 'moderation' : 'upstream',
      code,
      message: moderation ? '内容未通过审核' : '远端视频任务失败',
    };
  }
  return invalid();
}
async function call(ctx: AdapterContext, path: string, body?: object | FormData) {
  return imageResponse(
    await fetch(ctx.baseUrl + path, {
      method: body ? 'POST' : 'GET',
      signal: ctx.signal,
      redirect: 'error',
      headers: {
        ...ctx.headers,
        Authorization: `Bearer ${ctx.apiKey}`,
        ...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: body instanceof FormData ? body : JSON.stringify(body) } : {}),
    }),
  );
}
function content(ctx: AdapterContext, request: GenerationRequest) {
  return [
    { type: 'text', text: request.prompt },
    ...request.inputs.map((input) => {
      const type = `${input.kind}_url`;
      const url = input.dataUrl ?? ctx.referenceUrls?.[input.sha256!];
      if (!url)
        throw new GenerationFailure('invalid_params', 'MISSING_REFERENCE', '参考素材尚未准备好');
      return {
        type,
        [type]: { url },
        role: input.role === 'reference' ? `reference_${input.kind}` : input.role,
      };
    }),
  ];
}
export const arkVideoTasks: GenerationAdapter = {
  protocol: 'ark-video-tasks',
  async submit(ctx, request) {
    const json = await call(ctx, '/contents/generations/tasks', {
      model: ctx.model,
      content: content(ctx, request),
      ...request.params,
    });
    const result = z.object({ id: z.string().min(1) }).safeParse(json);
    if (!result.success) return invalid();
    return { status: 'running', remoteTaskId: result.data.id, remoteStatus: 'queued' };
  },
  async query(ctx, id) {
    return parseTask(await call(ctx, `/contents/generations/tasks/${encodeURIComponent(id)}`));
  },
};
export const minimaxVideoV2: GenerationAdapter = {
  protocol: 'minimax-video-v2',
  async submit(ctx, request) {
    if (request.prompt.length > 7000)
      throw new GenerationFailure(
        'invalid_params',
        'PROMPT_TOO_LONG',
        'H3 提示词不能超过 7000 字符',
      );
    const json = await call(ctx, '/v2/video_generation', {
      model: ctx.model,
      content: content(ctx, request),
      ...request.params,
    });
    const result = z.object({ task_id: z.string().min(1) }).safeParse(json);
    if (!result.success) return invalid();
    return { status: 'running', remoteTaskId: result.data.task_id, remoteStatus: 'queued' };
  },
  async query(ctx, id) {
    const json = z
      .object({ task: z.unknown() })
      .safeParse(await call(ctx, `/v2/query/video_generation/${encodeURIComponent(id)}`));
    return json.success ? parseTask(json.data.task) : invalid();
  },
};
export const openaiVideos: GenerationAdapter = {
  protocol: 'openai-videos',
  async submit(ctx, request) {
    const form = new FormData();
    form.set('model', ctx.model);
    form.set('prompt', request.prompt);
    for (const [key, value] of Object.entries(request.params)) form.set(key, String(value));
    const input = request.inputs[0];
    if (input?.dataUrl) {
      const [prefix, data] = input.dataUrl.split(',');
      const mime = prefix.slice(5, -7);
      form.set(
        'input_reference',
        new Blob([Buffer.from(data, 'base64')], { type: mime }),
        `reference.${mime.split('/')[1]}`,
      );
    }
    return parseTask(await call(ctx, '/videos', form), true);
  },
  async query(ctx, id) {
    return parseTask(await call(ctx, `/videos/${encodeURIComponent(id)}`), true);
  },
};
