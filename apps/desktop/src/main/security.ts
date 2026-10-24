import { isAbsolute, relative, resolve } from 'node:path';

export const APP_ORIGIN = 'app://frame-loom';

export function isTrustedUrl(value: string, origin: string): boolean {
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}` === origin && url.username === '' && url.password === '';
  } catch {
    return false;
  }
}

export function isTrustedSender(
  event: { sender: unknown; senderFrame: { url: string } | null },
  contents: { mainFrame: unknown },
  origin: string,
): boolean {
  return (
    event.sender === contents &&
    event.senderFrame !== null &&
    event.senderFrame === contents.mainFrame &&
    isTrustedUrl(event.senderFrame.url, origin)
  );
}

export function rendererFile(root: string, requestUrl: string): string | undefined {
  if (!isTrustedUrl(requestUrl, APP_ORIGIN)) return undefined;
  try {
    const pathname = decodeURIComponent(new URL(requestUrl).pathname);
    if (pathname.includes('\\') || pathname.includes('\0')) return undefined;
    const file = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
    const path = relative(root, file);
    if (path === '..' || path.startsWith('../') || path.startsWith('..\\') || isAbsolute(path))
      return undefined;
    return file;
  } catch {
    return undefined;
  }
}
