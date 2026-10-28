import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  APP_ORIGIN,
  PRODUCTION_CSP,
  isTrustedSender,
  isTrustedUrl,
  rendererFile,
} from './security.js';

it('生产 CSP 允许组件内联样式，脚本仍只允许同源', () => {
  expect(PRODUCTION_CSP.split('; ')).toContain("style-src 'self' 'unsafe-inline'");
  expect(PRODUCTION_CSP.split('; ')).toContain("script-src 'self' 'wasm-unsafe-eval'");
  expect(PRODUCTION_CSP).not.toContain("'unsafe-eval'");
  expect(PRODUCTION_CSP).not.toContain('https:');
  expect(PRODUCTION_CSP.split('; ')).toContain("worker-src 'self'");
  expect(PRODUCTION_CSP.split('; ')).toContain(
    "connect-src 'self' frame-media: frame-project: http://127.0.0.1:*",
  );
  expect(PRODUCTION_CSP.split('; ')).toContain("img-src 'self' frame-media: frame-project:");
  expect(PRODUCTION_CSP.split('; ')).toContain("media-src 'self' frame-media: frame-project:");
});

describe('可信页面边界', () => {
  it.each([APP_ORIGIN, `${APP_ORIGIN}/`, `${APP_ORIGIN}/index.html`])('允许应用页面 %s', (url) => {
    expect(isTrustedUrl(url, APP_ORIGIN)).toBe(true);
  });
  it.each([
    'https://frame-loom/',
    'app://frame-loom.evil/',
    'app://user@frame-loom/',
    'app://frame-loom:1234/',
    'file:///index.html',
    'null',
    'about:blank',
  ])('拒绝其他来源 %s', (url) => {
    expect(isTrustedUrl(url, APP_ORIGIN)).toBe(false);
  });
  it('开发源校验包含协议和端口', () => {
    expect(isTrustedUrl('http://127.0.0.1:5173/', 'http://127.0.0.1:5173')).toBe(true);
    expect(isTrustedUrl('http://127.0.0.1:5174/', 'http://127.0.0.1:5173')).toBe(false);
    expect(isTrustedUrl('https://127.0.0.1:5173/', 'http://127.0.0.1:5173')).toBe(false);
  });
  it('仅将连接交给同一窗口的可信主框架', () => {
    const frame = { url: `${APP_ORIGIN}/` };
    const contents = { mainFrame: frame };
    expect(isTrustedSender({ sender: contents, senderFrame: frame }, contents, APP_ORIGIN)).toBe(
      true,
    );
    expect(isTrustedSender({ sender: {}, senderFrame: frame }, contents, APP_ORIGIN)).toBe(false);
    expect(
      isTrustedSender({ sender: contents, senderFrame: { ...frame } }, contents, APP_ORIGIN),
    ).toBe(false);
    expect(isTrustedSender({ sender: contents, senderFrame: null }, contents, APP_ORIGIN)).toBe(
      false,
    );
    frame.url = 'https://example.com/';
    expect(isTrustedSender({ sender: contents, senderFrame: frame }, contents, APP_ORIGIN)).toBe(
      false,
    );
  });
});

describe('静态协议文件', () => {
  const root = resolve('renderer');
  it('将首页和资源解析在 renderer 目录内', () => {
    expect(rendererFile(root, `${APP_ORIGIN}/`)).toBe(resolve(root, 'index.html'));
    expect(rendererFile(root, `${APP_ORIGIN}/assets/main.js`)).toBe(
      resolve(root, 'assets/main.js'),
    );
  });
  it.each([
    'app://evil/index.html',
    `${APP_ORIGIN}/%2f..%2fsecret`,
    `${APP_ORIGIN}/%5c..%5csecret`,
    `${APP_ORIGIN}/%00`,
    `${APP_ORIGIN}/%zz`,
  ])('拒绝不可信或越界路径 %s', (url) => {
    expect(rendererFile(root, url)).toBeUndefined();
  });
});
