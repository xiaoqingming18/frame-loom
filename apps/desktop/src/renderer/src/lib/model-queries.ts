import { queryOptions } from '@tanstack/react-query';
import { Channel, Model, ModelDefaults } from '@frame-loom/contracts/model-service';
import type { EngineClient } from './engine-client';

export const channelsQuery = (client: EngineClient) =>
  queryOptions({
    queryKey: ['models', 'channels'],
    queryFn: ({ signal }) => client.request('/channels', Channel.array(), { signal }),
  });
export const modelsQuery = (client: EngineClient) =>
  queryOptions({
    queryKey: ['models', 'list'],
    queryFn: ({ signal }) => client.request('/models', Model.array(), { signal }),
  });
export const defaultsQuery = (client: EngineClient) =>
  queryOptions({
    queryKey: ['models', 'defaults'],
    queryFn: ({ signal }) => client.request('/model-defaults', ModelDefaults, { signal }),
  });
