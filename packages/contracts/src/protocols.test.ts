import { describe, expect, it } from 'vitest';
import { Capability } from './capabilities.js';
import { effectiveCapability } from './capability-check.js';
import { PROTOCOLS, getProtocol, protocolsForKind } from './protocols.js';

describe('首批协议描述契约', () => {
  it('15 个唯一 id，未知 id 不回退', () => {
    expect(PROTOCOLS).toHaveLength(15);
    expect(new Set(PROTOCOLS.map((p) => p.id)).size).toBe(15);
    expect(getProtocol('unknown')).toBeUndefined();
    expect(protocolsForKind('image').map((p) => p.id)).toContain('gemini-generate');
  });
  it.each(PROTOCOLS)('$id 模板合法且在协议上限内', (descriptor) => {
    expect(Object.keys(descriptor.templates).sort()).toEqual([...descriptor.kinds].sort());
    expect(Object.keys(descriptor.ceiling).sort()).toEqual([...descriptor.kinds].sort());
    for (const template of Object.values(descriptor.templates)) {
      expect(Capability.parse(template)).toEqual(template);
      expect(effectiveCapability(template, descriptor)).toEqual(template);
    }
  });
});
