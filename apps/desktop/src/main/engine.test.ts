import { EventEmitter } from 'node:events';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { engineEntry, manageEngine, waitForReady } from './engine.js';

class Child extends EventEmitter {
  postMessage = vi.fn();
  kill = vi.fn(() => true);
}

afterEach(() => vi.useRealTimers());

it('从应用路径而非工作目录解析开发及安装后的 engine 入口', () => {
  expect(engineEntry(false, resolve('apps/desktop'), resolve('resources'))).toBe(resolve('apps/engine/dist/main.js'));
  expect(engineEntry(true, resolve('app.asar'), resolve('resources'))).toBe(resolve('resources/engine/dist/main.js'));
});

describe('engine 就绪握手', () => {
  it('忽略无关消息，接受合法 ready 并移除临时监听', async () => {
    const child = new Child();
    const ready = waitForReady(child);
    child.emit('message', { type: 'log' });
    child.emit('message', { type: 'ready', port: 45678 });
    expect(await ready).toBe(45678);
    expect(child.listenerCount('message')).toBe(0);
    expect(child.listenerCount('exit')).toBe(0);
    expect(child.listenerCount('error')).toBe(0);
  });
  it.each([0, 65536, 1.2, '45678', undefined])('拒绝无效端口 %s', async (port) => {
    const child = new Child();
    const ready = waitForReady(child);
    child.emit('message', { type: 'ready', port });
    await expect(ready).rejects.toThrow('无效端口');
  });
  it('允许冷启动等待，30 秒未就绪时拒绝并清理监听', async () => {
    vi.useFakeTimers();
    const child = new Child();
    const result = expect(waitForReady(child)).rejects.toThrow('超时');
    await vi.advanceTimersByTimeAsync(15_000);
    expect(child.listenerCount('message')).toBe(1);
    await vi.advanceTimersByTimeAsync(15_000);
    await result;
    expect(child.listenerCount('message')).toBe(0);
  });
  it.each(['exit', 'error'])('就绪前收到 %s 时立即拒绝', async (event) => {
    const child = new Child();
    const result = waitForReady(child);
    child.emit(event, 1);
    await expect(result).rejects.toThrow();
  });
});

describe('engine 生命周期', () => {
  it('就绪前等待，退出后不再返回过期连接并通知调用者', async () => {
    const child = new Child();
    const onExit = vi.fn();
    const engine = manageEngine(child, 'secret', onExit);
    const connection = engine.getConnection();
    child.emit('message', { type: 'ready', port: 45678 });
    await expect(connection).resolves.toEqual({ baseUrl: 'http://127.0.0.1:45678', token: 'secret' });
    child.emit('exit', 3);
    await expect(engine.getConnection()).rejects.toThrow('已退出');
    expect(onExit).toHaveBeenCalledWith(3);
    await engine.stop();
    expect(child.postMessage).not.toHaveBeenCalled();
  });
  it('握手失败后终止子进程，连接调用收到错误', async () => {
    vi.useFakeTimers();
    const child = new Child();
    const engine = manageEngine(child, 'secret', vi.fn());
    const result = expect(engine.getConnection()).rejects.toThrow('超时');
    await vi.advanceTimersByTimeAsync(30_000);
    await result;
    expect(child.kill).toHaveBeenCalledOnce();
  });
  it('发送一次 shutdown 并等待退出，支持重复 stop', async () => {
    const child = new Child();
    const engine = manageEngine(child, 'secret', vi.fn());
    child.emit('message', { type: 'ready', port: 45678 });
    const stopping = engine.stop();
    expect(engine.stop()).toBe(stopping);
    expect(child.postMessage).toHaveBeenCalledExactlyOnceWith({ type: 'shutdown' });
    child.emit('exit', 0);
    await stopping;
    expect(child.kill).not.toHaveBeenCalled();
  });
  it('服务不响应 shutdown 时限时强制退出', async () => {
    vi.useFakeTimers();
    const child = new Child();
    const engine = manageEngine(child, 'secret', vi.fn());
    child.emit('message', { type: 'ready', port: 45678 });
    const stopping = engine.stop();
    await vi.advanceTimersByTimeAsync(5_000);
    await stopping;
    expect(child.kill).toHaveBeenCalledOnce();
  });
  it('shutdown 消息发送失败时终止进程', async () => {
    const child = new Child();
    child.postMessage.mockImplementation(() => { throw new Error('通道关闭'); });
    const engine = manageEngine(child, 'secret', vi.fn());
    child.emit('message', { type: 'ready', port: 45678 });
    await engine.stop();
    expect(child.kill).toHaveBeenCalledOnce();
  });
});
