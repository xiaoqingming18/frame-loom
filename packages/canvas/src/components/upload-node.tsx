import { Loader2 } from 'lucide-react';
import { Button } from '@frame-loom/ui/components/button';
import type { NodeProps } from '@xyflow/react';
import type { FlowNode } from './flow-mapping';

export function UploadNode({ data }: NodeProps<FlowNode>) {
  const upload = data.upload!;
  return (
    <div
      role="group"
      aria-label={`导入 ${data.node.title}`}
      className="flex size-full flex-col items-center justify-center gap-3 rounded-lg border border-dashed bg-card p-4 text-center text-sm text-foreground"
    >
      {!upload.error && (
        <Loader2 aria-hidden="true" className="size-6 animate-spin text-muted-foreground" />
      )}
      <span className="max-w-full truncate">{data.node.title}</span>
      <span className="line-clamp-3 text-xs text-muted-foreground">
        {upload.error ?? '正在上传…'}
      </span>
      <div className="nodrag nopan flex gap-2">
        {upload.error && (
          <Button size="sm" variant="outline" onClick={() => upload.retry()}>
            重试
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={() => upload.cancel()}>
          {upload.error ? '删除' : '取消'}
        </Button>
      </div>
    </div>
  );
}
