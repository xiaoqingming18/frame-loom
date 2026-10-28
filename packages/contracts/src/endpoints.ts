import type { CatalogFormat, EndpointOverride, Operation } from './model-service.js';
import type { ProtocolDescriptor } from './protocols.js';

export type ResolvedEndpoints = {
  operations: Partial<
    Record<Operation, { method: 'GET' | 'POST'; url: string; template: boolean }>
  >;
  foreignHosts: string[];
  issues: string[];
};
function splitBase(baseUrl: string) {
  const url = new URL(baseUrl);
  const path = url.pathname.replace(/\/+$/, '');
  const prefix = path.match(/\/(?:api\/v3|api\/v1|v1beta|v1)$/)?.[0] ?? '';
  return { origin: url.origin, path, prefix, deploy: path.slice(0, path.length - prefix.length) };
}
function encodeSegment(value: string) {
  if (value === '.' || value === '..' || /[/\\]/.test(value))
    throw new Error('路径参数不能包含点段或斜杠');
  return encodeURIComponent(value);
}
export function fillEndpoint(url: string, params: Record<string, string>) {
  return url.replace(/\{([a-z_]+)\}/g, (token, key: string) =>
    Object.hasOwn(params, key) ? encodeSegment(params[key]) : token,
  );
}
function mountFromSubmit(url: string, path: string) {
  const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = path
    .split(/(\{model\})/)
    .map((part) => (part === '{model}' ? '[^/?#]+' : escape(part)))
    .join('');
  const match = url.match(new RegExp(`${pattern}$`));
  return match ? url.slice(0, match.index) : undefined;
}
export function resolveEndpoints(
  channel: { baseUrl: string },
  model: { upstreamModelId: string; endpointOverride: EndpointOverride },
  descriptor: ProtocolDescriptor,
): ResolvedEndpoints {
  const base = splitBase(channel.baseUrl);
  const mount = `${base.origin}${base.prefix === descriptor.standardPrefix ? base.path : base.deploy + descriptor.standardPrefix}`;
  const override = model.endpointOverride;
  const submitUrl = override.operations?.submit ?? override.submitUrl;
  const derived =
    submitUrl && descriptor.operations.submit
      ? mountFromSubmit(submitUrl, descriptor.operations.submit.path)
      : undefined;
  const result: ResolvedEndpoints = { operations: {}, foreignHosts: [], issues: [] };
  for (const [key, spec] of Object.entries(descriptor.operations)) {
    const operation = key as Operation;
    const explicit =
      override.operations?.[operation] ?? (operation === 'submit' ? submitUrl : undefined);
    let url = explicit;
    if (!url) {
      if (submitUrl && derived === undefined) {
        result.issues.push(`无法从覆盖地址推导${operation}地址，请逐项填写`);
        continue;
      }
      url = `${derived ?? mount}${spec.path}`;
    }
    try {
      url = fillEndpoint(url, { model: model.upstreamModelId });
    } catch {
      result.issues.push('模型 ID 不能包含点段或斜杠');
      continue;
    }
    const host = new URL(url).host.toLowerCase();
    if (host !== new URL(channel.baseUrl).host.toLowerCase() && !result.foreignHosts.includes(host))
      result.foreignHosts.push(host);
    result.operations[operation] = { method: spec.method, url, template: /\{[a-z_]+\}/.test(url) };
  }
  return result;
}
export function resolveCatalogUrl(baseUrl: string, format: CatalogFormat) {
  const base = splitBase(baseUrl);
  const prefix = format === 'gemini' ? '/v1beta' : '/v1';
  return `${base.origin}${base.prefix === prefix ? base.path : base.deploy + prefix}/models`;
}
