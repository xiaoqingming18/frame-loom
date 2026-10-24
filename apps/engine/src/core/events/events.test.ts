import { EngineEvent, ErrorResponse } from '@frame-loom/contracts';
import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { createEngine } from '../../application.js';
import { EngineConfig } from '../config/config.js';
import { EventBus } from './event-bus.js';
import { EventsController } from './events.controller.js';

afterEach(() => vi.useRealTimers());

it('事件契约在发布边界校验，心跳定时发送，取消与关闭后释放订阅', async () => {
  vi.useFakeTimers();
  const bus = new EventBus();
  const events: unknown[] = [];
  const stream = new EventsController(bus).stream();
  const subscription = stream.subscribe((event) => events.push(event.data));
  await vi.advanceTimersByTimeAsync(0);
  expect(EngineEvent.parse(events[0]).type).toBe('heartbeat');
  bus.publish({ type: 'generation.job.updated', jobId: 'one' });
  expect(events[1]).toEqual({ type: 'generation.job.updated', jobId: 'one' });
  expect(() => bus.publish({ type: 'generation.job.updated', jobId: '' })).toThrow();
  await vi.advanceTimersByTimeAsync(15_000);
  expect(events).toHaveLength(3);
  subscription.unsubscribe();
  await vi.advanceTimersByTimeAsync(15_000);
  expect(events).toHaveLength(3);
  const next = stream.subscribe();
  bus.onModuleDestroy();
  expect(next.closed).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});

it('真实 HTTP 的 SSE 需要鉴权，发送心跳与事件，关闭应用结束流', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'frame-loom-events-'));
  const token = 'ab'.repeat(32);
  let app: INestApplication<Server> | undefined;
  const controller = new AbortController();
  try {
    app = await createEngine(new EngineConfig(token, directory, ['app://frame-loom']));
    await app.listen(0, '127.0.0.1');
    const port = (app.getHttpServer().address() as AddressInfo).port;
    const url = `http://127.0.0.1:${port}/events`;
    const denied = await fetch(url);
    expect(denied.status).toBe(401);
    expect(ErrorResponse.parse(await denied.json()).code).toBe('HTTP_401');
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Origin: 'app://frame-loom' },
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5_000)]),
    });
    expect(response.headers.get('Content-Type')).toContain('text/event-stream');
    expect(response.headers.get('access-control-allow-origin')).toBe('app://frame-loom');
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let received = '';
    while (!received.includes('heartbeat')) {
      received += decoder.decode((await reader.read()).value);
    }
    const heartbeat = received.match(/data: (.+)/)![1];
    expect(EngineEvent.parse(JSON.parse(heartbeat)).type).toBe('heartbeat');
    const event = { type: 'generation.job.updated' as const, jobId: 'job-one' };
    app.get(EventBus).publish(event);
    while (!received.includes('job-one')) {
      received += decoder.decode((await reader.read()).value);
    }
    expect(received).toContain(JSON.stringify(event));
    await app.close();
    app = undefined;
    while (!(await reader.read()).done) {
      // 服务关闭后必须自然结束流，不依赖客户端先断开。
    }
    reader.releaseLock();
  } finally {
    controller.abort();
    await app?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
