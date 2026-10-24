import { queryOptions } from '@tanstack/react-query';
import { HealthResponse } from '@frame-loom/contracts';
import type { EngineClient } from '@/lib/engine-client';

export const engineStatusKeys = { health: () => ['engine', 'health'] as const };

export function healthQueryOptions(engineClient: EngineClient) {
  return queryOptions({
    queryKey: engineStatusKeys.health(),
    staleTime: Infinity,
    retryOnMount: false,
    queryFn: ({ signal }) => engineClient.request('/health', HealthResponse, { signal }),
  });
}
