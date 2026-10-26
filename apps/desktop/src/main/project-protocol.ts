import { AssetPath, EngineConnection, ProjectId, Sha256 } from '@frame-loom/contracts';
import { APP_ORIGIN } from './security.js';

export function projectFileRoute(raw: string): string | undefined {
  const match = /^frame-project:\/\/([^/]+)\/(media|assets)\/([^?#]+)$/.exec(raw);
  if (!match || !ProjectId.safeParse(match[1]).success) return undefined;
  const [, id, kind, encoded] = match;
  try {
    const path = decodeURIComponent(encoded);
    if (kind === 'media')
      return Sha256.safeParse(path).success ? `/projects/${id}/files/media/${path}` : undefined;
    return AssetPath.safeParse(path).success
      ? `/projects/${id}/files/assets?path=${encodeURIComponent(path)}`
      : undefined;
  } catch {
    return undefined;
  }
}

export async function serveProjectFile(
  request: Request,
  getConnection: () => Promise<unknown>,
  origin = APP_ORIGIN,
): Promise<Response> {
  const path = projectFileRoute(request.url);
  const caller = request.headers.get('origin');
  if (!path || !['GET', 'HEAD'].includes(request.method) || (caller && caller !== origin))
    return new Response(null, { status: 403 });
  try {
    const { baseUrl, token } = EngineConnection.parse(await getConnection());
    const headers = new Headers({ Authorization: `Bearer ${token}` });
    const range = request.headers.get('range');
    if (range) headers.set('Range', range);
    const response = await fetch(`${baseUrl}${path}`, {
      method: request.method,
      headers,
      redirect: 'error',
      signal: request.signal,
    });
    const forwarded = new Headers();
    for (const name of [
      'content-type',
      'content-length',
      'content-range',
      'accept-ranges',
      'content-disposition',
      'etag',
      'last-modified',
      'cache-control',
    ]) {
      const value = response.headers.get(name);
      if (value) forwarded.set(name, value);
    }
    forwarded.set('X-Content-Type-Options', 'nosniff');
    forwarded.set('Access-Control-Allow-Origin', origin);
    forwarded.set('Vary', 'Origin');
    return new Response(request.method === 'HEAD' ? null : response.body, {
      status: response.status,
      headers: forwarded,
    });
  } catch {
    return new Response(null, { status: 502 });
  }
}
