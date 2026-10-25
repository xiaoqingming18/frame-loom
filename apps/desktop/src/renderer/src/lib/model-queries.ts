import { queryOptions } from '@tanstack/react-query';
import { ChannelList, ChannelModelList, ModelDefaults } from '@frame-loom/contracts';
import type { EngineClient } from './engine-client';

export const channelsQuery = (client: EngineClient) =>
  queryOptions({
    queryKey: ['models', 'channels'],
    queryFn: ({ signal }) => client.request('/channels', ChannelList, { signal }),
  });
export const modelsQuery = (client: EngineClient) =>
  queryOptions({
    queryKey: ['models', 'list'],
    queryFn: ({ signal }) => client.request('/channel-models', ChannelModelList, { signal }),
  });
export const defaultsQuery = (client: EngineClient) =>
  queryOptions({
    queryKey: ['models', 'defaults'],
    queryFn: ({ signal }) => client.request('/model-defaults', ModelDefaults, { signal }),
  });
