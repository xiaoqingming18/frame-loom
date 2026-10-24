import 'reflect-metadata';
import type { AddressInfo } from 'node:net';
import { createEngine } from './application.js';
import { loadConfig } from './core/config/config.js';
import { EngineLogger } from './core/logging/engine-logger.js';

interface ParentPort {
  postMessage(message: { type: 'ready'; port: number }): void;
  on(event: 'message', listener: (event: { data: unknown }) => void): void;
  removeAllListeners(event: 'message'): void;
}

const parentPort = (process as NodeJS.Process & { parentPort?: ParentPort }).parentPort;
const logger = new EngineLogger(process.env.FRAME_LOOM_TOKEN ?? '');

async function main(): Promise<void> {
  const config = loadConfig(process.env);
  const app = await createEngine(config);
  const listening = app.listen(0, '127.0.0.1');
  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    try {
      // 启动期间收到退出请求时，先结束监听初始化再关闭，避免关闭后重新打开端口。
      await listening.catch(() => undefined);
      await app.close();
    } catch (error) {
      logger.error('engine 关闭失败：', error instanceof Error ? error.stack : String(error));
      process.exitCode = 1;
    } finally {
      process.off('SIGTERM', onSignal);
      process.off('SIGINT', onSignal);
      parentPort?.removeAllListeners('message');
      // utilityProcess 不随 Node 句柄清空而退出，必须先完成资源关闭再显式结束。
      if (parentPort) process.exit(process.exitCode ?? 0);
    }
  };
  const onSignal = () => {
    void shutdown();
  };
  process.on('SIGTERM', onSignal);
  process.on('SIGINT', onSignal);
  parentPort?.on('message', ({ data }) => {
    if (typeof data === 'object' && data !== null && 'type' in data && data.type === 'shutdown') {
      void shutdown();
    }
  });
  try {
    await listening;
    if (closing) return;
    const { port } = app.getHttpServer().address() as AddressInfo;
    const ready = { type: 'ready' as const, port };
    if (parentPort) parentPort.postMessage(ready);
    else console.log(JSON.stringify(ready));
  } catch (error) {
    logger.error('engine 启动失败：', error instanceof Error ? error.stack : String(error));
    process.exitCode = 1;
    await shutdown();
  }
}

main().catch((error: unknown) => {
  logger.error('engine 启动失败：', error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
  if (parentPort) process.exit(1);
});
