import { describe, expect, it } from 'vitest';
import { HealthResponse } from './index.js';

const health: HealthResponse = {
  status: 'ok',
  engineVersion: '0.1.0',
  schemaVersion: '1',
  startedAt: '2026-10-24T08:00:00.000Z',
};

describe('HealthResponse', () => {
  it('接受合法健康响应', () => {
    expect(HealthResponse.parse(health)).toEqual(health);
  });

  it('接受带时区偏移的 ISO 时间', () => {
    const input = { ...health, startedAt: '2026-10-24T16:00:00+08:00' };
    expect(HealthResponse.parse(input)).toEqual(input);
  });

  it.each(['status', 'engineVersion', 'schemaVersion', 'startedAt'] as const)(
    '拒绝缺少 %s 的响应',
    (field) => {
      const input = { ...health };
      Reflect.deleteProperty(input, field);
      expect(HealthResponse.safeParse(input).success).toBe(false);
    },
  );

  it.each([
    { status: 'error' },
    { engineVersion: 1 },
    { schemaVersion: 1 },
    { startedAt: 1792828800000 },
    { startedAt: '不是时间' },
    { startedAt: '2026-10-24T08:00:00' },
    { startedAt: '2026-02-30T08:00:00Z' },
  ])('拒绝错误字段：%j', (invalid) => {
    expect(HealthResponse.safeParse({ ...health, ...invalid }).success).toBe(false);
  });
});
