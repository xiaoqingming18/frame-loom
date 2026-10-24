import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { healthQueryOptions } from '../api/health';
import type { EngineClient } from '@/lib/engine-client';

export function EngineStatusPanel({ engineClient }: { engineClient: EngineClient }) {
  const health = useQuery(healthQueryOptions(engineClient));
  return (
    <section aria-labelledby="engine-heading" className="space-y-5">
      <h2 id="engine-heading" className="text-base font-medium">
        本地引擎
      </h2>
      <p
        role="status"
        aria-live="polite"
        className={health.isError ? 'text-destructive' : 'text-foreground'}
      >
        {health.isError ? '连接中断' : health.isPending ? '正在连接' : '运行正常'}
      </p>
      {health.isPending && <p className="text-muted-foreground">正在启动本地服务，请稍候…</p>}
      {health.isError && (
        <div role="alert" className="space-y-2 text-destructive">
          <p>暂时无法连接本地引擎，请重新启动应用。</p>
          <p>{health.error.message}</p>
        </div>
      )}
      {health.data && !health.isError && (
        <dl className="space-y-4">
          <div>
            <dt className="text-xs text-muted-foreground">引擎版本</dt>
            <dd data-testid="engine-version" className="mt-1">
              {health.data.engineVersion}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">数据库版本</dt>
            <dd className="mt-1">{health.data.schemaVersion}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">启动时间</dt>
            <dd className="mt-1">
              <time dateTime={health.data.startedAt}>
                {new Date(health.data.startedAt).toLocaleString('zh-CN', { hour12: false })}
              </time>
            </dd>
          </div>
        </dl>
      )}
      <div className="flex items-center justify-between gap-3 border-t pt-4">
        <span className="text-xs text-muted-foreground">服务运行于此设备</span>
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
