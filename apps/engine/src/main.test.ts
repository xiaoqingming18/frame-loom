import { HealthResponse } from '@frame-loom/contracts';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';

// 部署冒烟复用相同的黑盒检查，入口可以指向仓库外的部署目录。
const entry =
  process.env.FRAME_LOOM_TEST_ENGINE_ENTRY ??
  fileURLToPath(new URL('../dist/main.js', import.meta.url));
const children: ChildProcess[] = [];
const directories: string[] = [];
const token = 'ab'.repeat(32);
const parentShim = `
  import { EventEmitter } from 'node:events';
  const port = new EventEmitter();
  port.postMessage = message => console.log(JSON.stringify(message));
  process.parentPort = port;
  // 模拟真实 utilityProcess 不会因关闭服务与移除消息监听而自然退出。
  setInterval(() => {}, 60_000);
  process.stdin.setEncoding('utf8');
  process.stdin.once('data', data => {
    const message = JSON.parse(data);
    if (message.type === 'SIGTERM' || message.type === 'SIGINT') process.emit(message.type);
    else port.emit('message', { data: message });
    process.stdin.pause();
  });
`;

afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill();
      await exited;
    }
  }
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

async function launch(withParent: boolean) {
  const directory = mkdtempSync(join(tmpdir(), 'frame-loom-process-'));
  directories.push(directory);
  const args = withParent
    ? ['--import', `data:text/javascript,${encodeURIComponent(parentShim)}`, entry]
    : [entry];
  const child = spawn(process.execPath, args, {
    cwd: tmpdir(),
    env: {
      ...process.env,
      FRAME_LOOM_TOKEN: token,
      FRAME_LOOM_DATA_DIR: directory,
      FRAME_LOOM_ALLOWED_ORIGINS: '[]',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  children.push(child);
  const lines = createInterface({ input: child.stdout });
  let stderr = '';
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
    stderr += chunk;
  });
  try {
    const [line] = (await Promise.race([
      once(lines, 'line', { signal: AbortSignal.timeout(10_000) }),
      once(child, 'exit').then(() => {
        throw new Error(`engine 未上报 ready：${stderr}`);
      }),
    ])) as unknown[];
    const ready = JSON.parse(line as string) as { type: string; port: number };
    expect(ready.type).toBe('ready');
    expect(ready.port).toBeGreaterThan(0);
    expect(ready.port).toBeLessThanOrEqual(65535);
    expect(existsSync(join(directory, 'data/frame-loom.sqlite'))).toBe(true);
    expect(existsSync(join(directory, 'media'))).toBe(true);
    return { child, port: ready.port, directory };
  } finally {
    lines.close();
  }
}

it('无配置时中文报错并非零退出', () => {
  const env = { ...process.env };
  delete env.FRAME_LOOM_TOKEN;
  delete env.FRAME_LOOM_DATA_DIR;
  const result = spawnSync(process.execPath, [entry], {
    cwd: tmpdir(),
    env,
    encoding: 'utf8',
    timeout: 10_000,
  });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('engine 配置无效');
  expect(result.stdout).not.toContain('ready');
});

it('配置无效时不泄露令牌', () => {
  const result = spawnSync(process.execPath, [entry], {
    cwd: tmpdir(),
    env: { ...process.env, FRAME_LOOM_TOKEN: 'private-invalid-token', FRAME_LOOM_DATA_DIR: '' },
    encoding: 'utf8',
    timeout: 10_000,
  });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('engine 配置无效');
  expect(result.stderr).not.toContain('private-invalid-token');
  expect(result.stdout).not.toContain('ready');
});

it('有 parentPort 的服务启动失败时非零退出，不被活动句柄阻塞', () => {
  const result = spawnSync(
    process.execPath,
    ['--import', `data:text/javascript,${encodeURIComponent(parentShim)}`, entry],
    {
      cwd: tmpdir(),
      env: { ...process.env, FRAME_LOOM_TOKEN: 'invalid' },
      encoding: 'utf8',
      timeout: 10_000,
    },
  );
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('engine 配置无效');
  expect(result.stdout).not.toContain('ready');
});

it('有 parentPort 的监听失败时清理数据库并保留非零退出码', () => {
  const directory = mkdtempSync(join(tmpdir(), 'frame-loom-listen-fail-'));
  directories.push(directory);
  const shim = `${parentShim}
    const { Server } = await import('node:net');
    Server.prototype.listen = function () {
      queueMicrotask(() => this.emit('error', new Error('模拟监听失败')));
      return this;
    };
  `;
  const result = spawnSync(
    process.execPath,
    ['--import', `data:text/javascript,${encodeURIComponent(shim)}`, entry],
    {
      cwd: tmpdir(),
      env: {
        ...process.env,
        FRAME_LOOM_TOKEN: token,
        FRAME_LOOM_DATA_DIR: directory,
        FRAME_LOOM_ALLOWED_ORIGINS: '[]',
      },
      encoding: 'utf8',
      timeout: 10_000,
    },
  );
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('模拟监听失败');
  expect(result.stdout).not.toContain('ready');
  expect(existsSync(join(directory, 'data/frame-loom.sqlite-wal'))).toBe(false);
});

it('数据库损坏时在监听和 ready 之前失败', () => {
  const directory = mkdtempSync(join(tmpdir(), 'frame-loom-invalid-db-'));
  directories.push(directory);
  mkdirSync(join(directory, 'data'));
  writeFileSync(join(directory, 'data/frame-loom.sqlite'), '损坏的数据库');
  const result = spawnSync(process.execPath, [entry], {
    cwd: tmpdir(),
    env: {
      ...process.env,
      FRAME_LOOM_TOKEN: token,
      FRAME_LOOM_DATA_DIR: directory,
      FRAME_LOOM_ALLOWED_ORIGINS: '[]',
    },
    encoding: 'utf8',
    timeout: 10_000,
  });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('engine 启动失败');
  expect(result.stdout).not.toContain('ready');
});

it('监听初始化期间收到 shutdown 时退出，不再上报 ready', () => {
  const directory = mkdtempSync(join(tmpdir(), 'frame-loom-early-exit-'));
  directories.push(directory);
  const shim = `
    import { EventEmitter } from 'node:events';
    const port = new EventEmitter();
    port.postMessage = message => console.log(JSON.stringify(message));
    port.on('newListener', event => {
      if (event === 'message') queueMicrotask(() => port.emit('message', { data: { type: 'shutdown' } }));
    });
    process.parentPort = port;
  `;
  const result = spawnSync(
    process.execPath,
    ['--import', `data:text/javascript,${encodeURIComponent(shim)}`, entry],
    {
      cwd: tmpdir(),
      env: {
        ...process.env,
        FRAME_LOOM_TOKEN: token,
        FRAME_LOOM_DATA_DIR: directory,
        FRAME_LOOM_ALLOWED_ORIGINS: '[]',
      },
      encoding: 'utf8',
      timeout: 10_000,
    },
  );
  expect(result.status).toBe(0);
  expect(result.stdout).not.toContain('ready');
  expect(result.stderr).toBe('');
  expect(existsSync(join(directory, 'data/frame-loom.sqlite-wal'))).toBe(false);
});

it('独立入口从其他工作目录启动，迁移后输出端口并提供鉴权健康检查', async () => {
  const { port } = await launch(false);
  const baseUrl = `http://127.0.0.1:${port}/health`;
  expect((await fetch(baseUrl)).status).toBe(401);
  const response = await fetch(baseUrl, { headers: { Authorization: `Bearer ${token}` } });
  expect(response.status).toBe(200);
  const { version } = JSON.parse(readFileSync(join(dirname(entry), '../package.json'), 'utf8')) as {
    version: string;
  };
  expect(HealthResponse.parse(await response.json())).toMatchObject({
    engineVersion: version,
    schemaVersion: '1',
  });
});

it.each(['shutdown', 'SIGTERM', 'SIGINT'])(
  '通过 parentPort 上报 ready，并处理 %s 关闭 HTTP 与数据库',
  async (type) => {
    const { child, port, directory } = await launch(true);
    const exited = once(child, 'exit', { signal: AbortSignal.timeout(10_000) });
    child.stdin.end(JSON.stringify({ type }));
    const [code] = (await exited) as unknown[];
    expect(code).toBe(0);
    expect(existsSync(join(directory, 'data/frame-loom.sqlite-wal'))).toBe(false);
    await expect(fetch(`http://127.0.0.1:${port}/health`)).rejects.toThrow();
  },
);
