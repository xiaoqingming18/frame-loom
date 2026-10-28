import { CapabilityPreview } from '@frame-loom/canvas';
import { type Capability, type ProtocolDescriptor } from '@frame-loom/contracts';

export function CanvasPreview({
  capability,
  descriptor,
  name,
}: {
  capability: Capability;
  descriptor: ProtocolDescriptor;
  name: string;
}) {
  const cap = capability;
  return (
    <aside
      className="space-y-4 rounded-xl border border-border bg-muted/30 p-4 text-xs"
      aria-label="画布参数预览"
    >
      <h3 className="font-medium">画布参数预览</h3>
      <p className="truncate font-medium">{name || '模型'}</p>
      <div className="rounded-lg border border-dashed border-border px-3 py-6 text-muted-foreground">
        {cap.kind === 'tts'
          ? '输入需要朗读的文本…'
          : cap.kind === 'chat'
            ? '输入消息…'
            : '描述你想创作的画面…'}
      </div>
      {cap.kind !== 'chat' && <CapabilityPreview capability={cap} protocol={descriptor} />}
      {cap.kind === 'chat' && (
        <>
          <p>{cap.inputModalities.length ? '可添加附件' : '文本输入'}</p>
          {cap.reasoningLevels.length > 0 && <p>推理档位：{cap.reasoningLevels.join(' / ')}</p>}
        </>
      )}
    </aside>
  );
}
