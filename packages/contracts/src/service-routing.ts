import { resolveServiceUrl, type ModelConnection, type ServiceOperation } from './models.js';

export const serviceRoutes: Record<string, Partial<Record<ServiceOperation, string>>> = {
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
};
export const connectionTemplates = [
  {
    id: 'liuguang-h3',
    name: '流光 H3 原生',
    protocol: 'minimax-video-v2',
    baseUrl: 'https://liuguang.ai',
  },
  {
    id: 'liuguang-video',
    name: '流光 OpenAI 视频',
    protocol: 'openai-videos',
    baseUrl: 'https://liuguang.ai/v1',
  },
  {
    id: 'fastaitoken-video',
    name: 'FastAIToken 视频',
    protocol: 'fastaitoken-video',
    baseUrl: 'https://video.fastaitoken.com',
  },
  {
    id: 'openai-images',
    name: 'OpenAI Images',
    protocol: 'openai-images',
    baseUrl: 'https://api.openai.com/v1',
  },
  {
    id: 'gemini-image',
    name: 'Gemini 原生图片',
    protocol: 'gemini-image',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
  },
  {
    id: 'ark-images',
    name: '方舟图片',
    protocol: 'ark-images',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
  },
  {
    id: 'ark-video',
    name: '方舟视频',
    protocol: 'ark-video-tasks',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
  },
] as const;
export const connectionTemplateVersion = 'v1';

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
