import { useQuery } from '@tanstack/react-query';
import { Button } from '@frame-loom/ui/components/button';
import { healthQueryOptions } from '../api/health';
import type { EngineClient } from '@/lib/engine-client';

export function EngineStatusPanel({ engineClient }: { engineClient: EngineClient }) {
  const health = useQuery(healthQueryOptions(engineClient));
  return (
    <section aria-labelledby="engine-heading">
      <h2 id="engine-heading" className="text-xl font-semibold">
        本地引擎
      </h2>
      <div className="mt-9 mb-6 flex items-center justify-between gap-4">
        <div className="space-y-1.5">
          <h3 className="text-sm font-medium">连接状态</h3>
          <p className="text-xs text-muted-foreground">服务运行于此设备</p>
        </div>
        <p
          role="status"
          aria-live="polite"
          className={
            health.isError ? 'text-sm text-destructive' : 'rounded-lg bg-muted px-3 py-1.5 text-sm'
          }
        >
          {health.isError ? '连接中断' : health.isPending ? '正在连接' : '运行正常'}
        </p>
      </div>
      {health.isPending && <p className="text-muted-foreground">正在启动本地服务，请稍候…</p>}
      {health.isError && (
        <div role="alert" className="space-y-2 break-words text-destructive">
          <p>暂时无法连接本地引擎，请重新启动应用。</p>
          <p>{health.error.message}</p>
        </div>
      )}
      {health.data && !health.isError && (
        <dl className="divide-y text-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 py-5">
            <dt>引擎版本</dt>
            <dd data-testid="engine-version" className="text-muted-foreground">
              {health.data.engineVersion}
            </dd>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 py-5">
            <dt>数据库版本</dt>
            <dd className="text-muted-foreground">{health.data.schemaVersion}</dd>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 py-5">
            <dt>启动时间</dt>
            <dd className="text-muted-foreground">
              <time dateTime={health.data.startedAt}>
                {new Date(health.data.startedAt).toLocaleString('zh-CN', { hour12: false })}
              </time>
            </dd>
          </div>
        </dl>
      )}
      <div className="mt-3 flex justify-end border-t pt-5">
        <Button
          variant="outline"
          size="sm"
          disabled={health.isFetching}
          onClick={() => void health.refetch()}
        >
          {health.isFetching ? '连接中…' : '重新检查'}
        </Button>
      </div>
    </section>
  );
}
