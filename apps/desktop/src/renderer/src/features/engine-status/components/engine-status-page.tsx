import { useQuery } from '@tanstack/react-query';
import { healthQueryOptions } from '../api/health';
import type { EngineClient } from '@/lib/engine-client';

export function EngineStatusPage({ engineClient }: { engineClient: EngineClient }) {
  const health = useQuery(healthQueryOptions(engineClient));
  const state = health.isError ? 'error' : health.isPending ? 'pending' : 'ready';
  return (
    <div className="workspace flex min-h-screen flex-col">
      <header className="topbar flex items-center justify-between">
        <div className="brand flex items-center">
          <span className="brand-mark" aria-hidden="true">
            F<span>L</span>
          </span>
          <strong>FRAME LOOM</strong>
        </div>
        <span className="edition">影视创作工作台</span>
      </header>
      <main className="flex flex-1 flex-col justify-center">
        <div className="eyebrow">工作台 / 运行状态</div>
        <div className="intro">
          <span className="index" aria-hidden="true">
            01
          </span>
          <h1>
            创作，从这里开始<span>。</span>
          </h1>
        </div>
        <p className="subtitle">每一个故事，都值得被看见。</p>
        <section className="status-panel" aria-labelledby="engine-heading">
          <div className="panel-heading flex items-center justify-between">
            <h2 id="engine-heading">本地引擎</h2>
            <span className={`status ${state}`} role="status" aria-live="polite">
              <span className="status-dot" aria-hidden="true" />
              {state === 'ready' ? '运行正常' : state === 'pending' ? '正在连接' : '连接中断'}
            </span>
          </div>
          {health.isPending && <p className="message">正在启动本地服务，请稍候…</p>}
          {health.isError && (
            <div className="message" role="alert">
              <p>暂时无法连接本地引擎，请重新启动应用。</p>
              <p className="error-detail">{health.error.message}</p>
            </div>
          )}
          {health.data && !health.isError && (
            <dl className="metrics grid grid-cols-1 sm:grid-cols-3">
              <div>
                <dt>引擎版本</dt>
                <dd data-testid="engine-version">{health.data.engineVersion}</dd>
              </div>
              <div>
                <dt>数据库版本</dt>
                <dd>{health.data.schemaVersion}</dd>
              </div>
              <div>
                <dt>启动时间</dt>
                <dd className="timestamp">
                  <time dateTime={health.data.startedAt}>
                    {new Date(health.data.startedAt).toLocaleString('zh-CN', { hour12: false })}
                  </time>
                </dd>
              </div>
            </dl>
          )}
          <div className="panel-footer flex items-center justify-between">
            <span>服务运行于此设备</span>
            <button
              type="button"
              disabled={health.isFetching}
              onClick={() => void health.refetch()}
            >
              {health.isFetching ? '连接中…' : '重新检查'}
              <span aria-hidden="true"> ↗</span>
            </button>
          </div>
        </section>
        <p className="scope-note">当前为应用基础骨架，创作功能将逐步开放。</p>
      </main>
      <footer className="page-footer flex justify-between">
        <span>FRAME LOOM · 让想象成帧</span>
        <span>本地工作空间</span>
      </footer>
    </div>
  );
}
