import { EngineConnection, ErrorResponse, HealthResponse } from '@frame-loom/contracts';

export async function fetchHealth(signal: AbortSignal): Promise<HealthResponse> {
  const connection = EngineConnection.parse(await window.frameLoom.getEngineConnection());
  const response = await fetch(`${connection.baseUrl}/health`, {
    headers: { Authorization: `Bearer ${connection.token}` },
    signal: AbortSignal.any([signal, AbortSignal.timeout(5_000)]),
  });
  if (!response.ok) {
    const error = ErrorResponse.safeParse(await response.json().catch(() => null));
    throw new Error(
      error.success ? error.data.message : `本地服务请求失败（HTTP ${response.status}）`,
    );
  }
  return HealthResponse.parse(await response.json());
}
