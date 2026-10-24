import { expect, it } from 'vitest';
import { EngineEvent } from './index.js';

it.each([
  { type: 'heartbeat', timestamp: '2026-10-24T00:00:00Z' },
  { type: 'generation.job.updated', jobId: 'job-one' },
])('接受类型化事件：$type', (event) => {
  expect(EngineEvent.parse(event)).toEqual(event);
});

it.each([
  {},
  { type: 'unknown' },
  { type: 'heartbeat' },
  { type: 'heartbeat', timestamp: 'today' },
  { type: 'generation.job.updated', jobId: '' },
  { type: 'generation.job.updated', jobId: 1 },
])('拒绝未知类型或非法事件字段', (event) => {
  expect(EngineEvent.safeParse(event).success).toBe(false);
});
