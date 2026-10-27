import { resolveServiceUrl, type ModelConnection, type ServiceOperation } from './models.js';

export const serviceRoutes: Record<string, Partial<Record<ServiceOperation, string>>> = {
  'openai-speech': { submit: 'audio/speech' },
  'minimax-t2a': { submit: 'v1/t2a_v2' },
  'openai-images': { submit: 'images/generations', edit: 'images/edits' },
  'gemini-image': { submit: 'models/{model}:generateContent' },
  'ark-images': { submit: 'images/generations' },
  'ark-video-tasks': {
    submit: 'contents/generations/tasks',
    query: 'contents/generations/tasks/{id}',
  },
  'minimax-video-v2': {
    submit: 'minimax/v2/video_generation',
    query: 'minimax/v2/query/video_generation/{id}',
  },
  'openai-videos': { submit: 'videos', query: 'videos/{id}', content: 'videos/{id}/content' },
  'fastaitoken-video': {
    submit: 'v1/videos/generations',
    query: 'v1/videos/{id}',
    content: 'v1/videos/{id}/content',
    upload: 'api/v1/uploads',
    catalog: 'api/v1/models',
  },
  'kling-video': {
    submit: 'v1/videos/text2video',
    query: 'v1/videos/{id}',
    content: 'v1/videos/{id}',
  },
  'wan-video': {
    submit: 'api/v1/services/aigc/video-generation/video-synthesis',
    query: 'api/v1/tasks/{id}',
  },
};

export function resolveModelOperation(
  baseUrl: string,
  connection: ModelConnection | undefined,
  protocol: string,
  operation: ServiceOperation,
  params: Record<string, string> = {},
) {
  const path = connection?.routes?.[operation] ?? serviceRoutes[protocol]?.[operation];
  if (!path) throw new Error('当前协议不支持该操作');
  const base =
    connection?.baseUrl ??
    (protocol === 'minimax-video-v2' ? baseUrl.replace(/\/v1\/?$/, '') : baseUrl);
  return resolveServiceUrl(base, path, params);
}
