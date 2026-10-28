import { describe, expect, it } from 'vitest';
import { Capability } from './capabilities.js';
import { effectiveCapability } from './capability-check.js';
import { changeProtocol } from './capability-check.js';
import { ExtraParam, ModelWrite } from './model-service.js';
import { PROTOCOLS, getProtocol, protocolsForKind } from './protocols.js';

describe('首批协议描述契约', () => {
  it('15 个唯一 id，未知 id 不回退', () => {
    expect(PROTOCOLS).toHaveLength(15);
    expect(new Set(PROTOCOLS.map((p) => p.id)).size).toBe(15);
    expect(getProtocol('unknown')).toBeUndefined();
    expect(protocolsForKind('image').map((p) => p.id)).toContain('gemini-generate');
  });
  it.each(PROTOCOLS)('$id 模板合法且在协议上限内', (descriptor) => {
    expect(descriptor.sources.length).toBeGreaterThan(0);
    for (const source of descriptor.sources) {
      expect(source.url).toMatch(/^https:\/\//);
      expect(source.checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    expect(Object.keys(descriptor.templates).sort()).toEqual([...descriptor.kinds].sort());
    expect(Object.keys(descriptor.ceiling).sort()).toEqual([...descriptor.kinds].sort());
    for (const template of Object.values(descriptor.templates)) {
      expect(Capability.parse(template)).toEqual(template);
      expect(effectiveCapability(template, descriptor)).toEqual(template);
    }
    for (const extra of descriptor.defaultExtras ?? [])
      expect(ExtraParam.parse(extra)).toEqual(extra);
  });
  it('切换 Seedream 预填关闭水印，已有显式选择不被覆盖', () => {
    const write = ModelWrite.parse({
      kind: 'image',
      protocolId: 'openai-images',
      upstreamModelId: 'alias',
      displayName: '测试',
      enabled: false,
      capability: getProtocol('openai-images')!.templates.image,
    });
    const changed = changeProtocol(write, 'ark-seedream');
    expect(changed.model.extras).toEqual([
      { key: 'watermark', label: '水印', type: 'boolean', path: 'watermark', default: false },
    ]);
    changed.model.extras[0].default = true;
    expect(changeProtocol(changed.model, 'ark-seedream').model.extras[0].default).toBe(true);
  });
});
