import { AudioLines } from 'lucide-react';
import type { CanvasMediaData } from '@frame-loom/contracts';
import { useCanvas } from '../context';
import type { NodeViewProps } from '../registry/registry';
import { activeVersion } from './media';
import { MediaFrame } from './views';

export function AudioNodeView(props: NodeViewProps<CanvasMediaData>) {
  const { host } = useCanvas();
  const version = activeVersion(props.node.data);
  return (
    <MediaFrame {...props} kind="audio">
      <div className="flex size-full flex-col items-center justify-center gap-3 p-4 text-xs text-muted-foreground">
        <AudioLines aria-hidden="true" className="size-7" />
        {version ? (
          <>
            <span>
              {version.durationMs === null
                ? '时长未知'
                : `${((version.durationMs ?? 0) / 1000).toFixed(1)} 秒`}
            </span>
            <audio
              key={version.sha256}
              aria-label={props.node.title ?? '音频'}
              src={host.media.url(version.sha256)}
              controls
              preload="metadata"
              className="nodrag nopan h-8 w-full"
            />
          </>
        ) : (
          <span>填写文本，生成语音</span>
        )}
      </div>
    </MediaFrame>
  );
}
