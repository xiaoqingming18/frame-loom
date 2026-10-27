import { z } from 'zod';
import type { GenerationRequest } from '@frame-loom/contracts';
import { resolveServiceUrl } from '@frame-loom/contracts';
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
    await fetch(resolveServiceUrl(ctx.connection?.baseUrl ?? ctx.baseUrl, path), {
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
    const routeContext = ctx.connection?.baseUrl
      ? ctx
      : { ...ctx, baseUrl: ctx.baseUrl.replace(/\/v1\/?$/, '') };
    if (request.prompt.length > 7000)
      throw new GenerationFailure(
        'invalid_params',
        'PROMPT_TOO_LONG',
        'H3 提示词不能超过 7000 字符',
      );
    const json = await call(
      routeContext,
      ctx.connection?.routes?.submit ?? 'minimax/v2/video_generation',
      {
        model: ctx.model,
        content: content(ctx, request),
        ...request.params,
      },
    );
    const result = z.object({ task_id: z.string().min(1) }).safeParse(json);
    if (!result.success) return invalid();
    return { status: 'running', remoteTaskId: result.data.task_id, remoteStatus: 'queued' };
  },
  async query(ctx, id) {
    const routeContext = ctx.connection?.baseUrl
      ? ctx
      : { ...ctx, baseUrl: ctx.baseUrl.replace(/\/v1\/?$/, '') };
    const json = await call(
      routeContext,
      (ctx.connection?.routes?.query ?? 'minimax/v2/query/video_generation/{id}').replace(
        '{id}',
        encodeURIComponent(id),
      ),
    );
    if (json && typeof json === 'object' && 'task' in json) {
      const task = (json as { task: unknown }).task;
      return parseTask(task && typeof task === 'object' ? { ...(task as object), id } : task);
    }
    if (json && typeof json === 'object' && 'task_id' in json)
      return parseTask({
        ...(json as Record<string, unknown>),
        id: (json as { task_id: string }).task_id,
      });
    return parseTask(json);
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
    return parseTask(await call(ctx, ctx.connection?.routes?.submit ?? 'videos', form), true);
  },
  async query(ctx, id) {
    return parseTask(
      await call(
        ctx,
        (ctx.connection?.routes?.query ?? 'videos/{id}').replace('{id}', encodeURIComponent(id)),
      ),
      true,
    );
  },
  contentUrl(ctx, id) {
    return resolveServiceUrl(
      ctx.connection?.baseUrl ?? ctx.baseUrl,
      (ctx.connection?.routes?.content ?? 'videos/{id}/content').replace(
        '{id}',
        encodeURIComponent(id),
      ),
    );
  },
};

export const fastaitokenVideo: GenerationAdapter = {
  protocol: 'fastaitoken-video',
  async submit(ctx, request) {
    const inputs = request.inputs.map((input) => ({
      role: input.role,
      kind: input.kind,
      url: input.dataUrl ?? ctx.referenceUrls?.[input.sha256!],
    }));
    if (inputs.some((item) => !item.url))
      throw new GenerationFailure('invalid_params', 'MISSING_REFERENCE', '参考素材尚未准备好');
    const json = await call(ctx, ctx.connection?.routes?.submit ?? 'v1/videos/generations', {
      model: ctx.model,
      prompt: request.prompt,
      mode: request.mode,
      inputs,
      ...request.params,
    });
    const parsed = z
      .object({
        id: z.string().min(1).optional(),
        task_id: z.string().min(1).optional(),
        status: z.string().optional(),
        video_url: z.url().optional(),
        download_url: z.url().optional(),
        result_url: z.url().optional(),
        error_code: z.union([z.string(), z.number()]).optional(),
      })
      .safeParse(json);
    if (!parsed.success) return invalid();
    if (parsed.data.error_code)
      return {
        status: 'failed',
        category: 'upstream',
        code: String(parsed.data.error_code),
        message: 'FastAIToken 视频请求失败',
      };
    const id = parsed.data.id ?? parsed.data.task_id;
    if (!id) return invalid();
    const url = parsed.data.video_url ?? parsed.data.download_url ?? parsed.data.result_url;
    return url
      ? { status: 'succeeded', outputs: [{ mime: 'video/mp4', url }] }
      : { status: 'running', remoteTaskId: id, remoteStatus: parsed.data.status ?? 'processing' };
  },
  async query(ctx, id) {
    const parsed = z
      .object({
        status: z.string(),
        video_url: z.url().optional(),
        download_url: z.url().optional(),
        result_url: z.url().optional(),
        error_code: z.union([z.string(), z.number()]).optional(),
      })
      .safeParse(
        await call(
          ctx,
          (ctx.connection?.routes?.query ?? 'v1/videos/{id}').replace(
            '{id}',
            encodeURIComponent(id),
          ),
        ),
      );
    if (!parsed.success) return invalid();
    if (['completed', 'succeeded'].includes(parsed.data.status)) {
      const url = parsed.data.video_url ?? parsed.data.download_url ?? parsed.data.result_url;
      if (!url) return invalid();
      return { status: 'succeeded', outputs: [{ mime: 'video/mp4', url }] };
    }
    if (['failed', 'cancelled', 'expired'].includes(parsed.data.status))
      return {
        status: 'failed',
        category: 'upstream',
        code: String(parsed.data.error_code ?? 'VIDEO_FAILED'),
        message: '远端视频任务失败',
      };
    return { status: 'running', remoteTaskId: id, remoteStatus: parsed.data.status };
  },
  contentUrl(ctx, id) {
    return resolveServiceUrl(
      ctx.connection?.baseUrl ?? ctx.baseUrl,
      (ctx.connection?.routes?.content ?? 'v1/videos/{id}/content').replace(
        '{id}',
        encodeURIComponent(id),
      ),
    );
  },
};
