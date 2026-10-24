import type { EventEmitter } from 'node:events';
import { resolve } from 'node:path';
import { EngineConnection } from '@frame-loom/contracts';

interface EngineChild extends EventEmitter {
  postMessage(message: unknown): void;
  kill(): boolean;
}

export function engineEntry(isPackaged: boolean, appPath: string, resourcesPath: string): string {
  return isPackaged
    ? resolve(resourcesPath, 'engine/dist/main.js')
    : resolve(appPath, '../engine/dist/main.js');
}

export function waitForReady(child: EngineChild, timeout = 30_000): Promise<number> {
  return new Promise((resolveReady, reject) => {
    const finish = (error?: Error, port?: number) => {
      clearTimeout(timer);
      child.off('message', onMessage);
      child.off('exit', onExit);
      child.off('error', onError);
      if (error) reject(error);
      else resolveReady(port!);
    };
    const onMessage = (message: unknown) => {
      if (typeof message !== 'object' || message === null || !('type' in message) || message.type !== 'ready') return;
      if (!('port' in message) || typeof message.port !== 'number'
        || !Number.isInteger(message.port) || message.port < 1 || message.port > 65535) {
        finish(new Error('本地服务返回了无效端口'));
      } else finish(undefined, message.port);
    };
    const onExit = (code: number) => finish(new Error(`本地服务在就绪前退出（退出码 ${code}）`));
    const onError = () => finish(new Error('本地服务进程启动失败'));
    const timer = setTimeout(() => finish(new Error('本地服务启动超时（30 秒）')), timeout);
    child.on('message', onMessage);
    child.once('exit', onExit);
    child.once('error', onError);
  });
}

export function manageEngine(child: EngineChild, token: string, onExit: (code: number) => void) {
  let exited = false;
  let stopping: Promise<void> | undefined;
  let failure: Error | undefined;
  child.on('error', () => {
    failure = new Error('本地服务进程异常，请重新启动应用');
    child.kill();
  });
  child.once('exit', (code: number) => {
    exited = true;
    failure = new Error(`本地服务已退出（退出码 ${code}），请重新启动应用`);
    onExit(code);
  });
  const ready = waitForReady(child).then((port) => {
    console.info(`engine 已就绪，端口 ${port}`);
    return EngineConnection.parse({ baseUrl: `http://127.0.0.1:${port}`, token });
  }).catch((error: Error) => {
    failure = error;
    child.kill();
    return undefined;
  });

  return {
    async getConnection(): Promise<EngineConnection> {
      const connection = await ready;
      if (failure) throw failure;
      return connection!;
    },
    stop(): Promise<void> {
      if (stopping) return stopping;
      if (exited) return Promise.resolve();
      stopping = new Promise<void>((resolveStopped) => {
        const finish = () => {
          clearTimeout(timer);
          child.off('exit', finish);
          resolveStopped();
        };
        const timer = setTimeout(() => {
          console.error('engine 未按时关闭，强制终止');
          child.kill();
          finish();
        }, 5_000);
        child.once('exit', finish);
        try {
          child.postMessage({ type: 'shutdown' });
        } catch {
          child.kill();
          finish();
        }
      });
      return stopping;
    },
  };
}
