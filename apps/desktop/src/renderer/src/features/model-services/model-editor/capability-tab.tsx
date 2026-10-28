import {
  getProtocol,
  type Capability,
  type CapabilityGroup,
  restoreCapabilityGroup,
} from '@frame-loom/contracts';
import type { ModelWrite } from '@frame-loom/contracts';
import { Button } from '@frame-loom/ui/components/button';
import { CapabilityChat } from './capability-chat';
import { CapabilityImage } from './capability-image';
import { CapabilityVideo } from './capability-video';
import { CapabilityTts } from './capability-tts';
import { CanvasPreview } from './canvas-preview';
import { CapabilityComparison } from './capability-comparison';

const groups: Record<Capability['kind'], { id: CapabilityGroup; label: string }[]> = {
  chat: [
    { id: 'limits', label: '长度限制' },
    { id: 'references', label: '输入能力' },
  ],
  image: [
    { id: 'references', label: '参考图' },
    { id: 'size', label: '尺寸' },
    { id: 'quality', label: '质量' },
    { id: 'output', label: '输出' },
    { id: 'limits', label: '数量与字数' },
  ],
  video: [
    { id: 'modes', label: '生成方式' },
    { id: 'references', label: '参考限制' },
    { id: 'duration', label: '时长' },
    { id: 'frame', label: '比例与分辨率' },
    { id: 'audio', label: '声音' },
    { id: 'limits', label: '字数限制' },
  ],
  tts: [
    { id: 'voices', label: '音色' },
    { id: 'style', label: '风格' },
    { id: 'output', label: '输出' },
    { id: 'limits', label: '字数与人数' },
  ],
};
export function CapabilityTab({
  draft,
  onChange,
  onRestore,
}: {
  draft: ModelWrite;
  onChange: (capability: Capability) => void;
  onRestore: (group: CapabilityGroup) => void;
}) {
  const descriptor = draft.protocolId ? getProtocol(draft.protocolId) : undefined;
  const cap = draft.capability;
  if (!descriptor)
    return <p className="text-sm text-muted-foreground">请先在基本信息中选择请求协议。</p>;
  return (
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
      <div className="min-w-0 space-y-5">
        <div className="flex flex-wrap gap-2">
          {groups[cap.kind].map((group) => {
            const changed =
              JSON.stringify(restoreCapabilityGroup(cap, descriptor, group.id)) !==
              JSON.stringify(cap);
            return (
              <div
                key={group.id}
                className={`border-l-2 pl-2 ${changed ? 'border-primary' : 'border-transparent'}`}
              >
                <Button
                  size="xs"
                  variant="ghost"
                  title={`恢复${group.label}`}
                  onClick={() => onRestore(group.id)}
                >
                  {group.label} · 恢复为协议默认
                </Button>
              </div>
            );
          })}
        </div>
        <CapabilityComparison value={{ current: cap, template: descriptor.templates[cap.kind]! }}>
          {cap.kind === 'chat' ? (
            <CapabilityChat value={cap} onChange={onChange} descriptor={descriptor} />
          ) : cap.kind === 'image' ? (
            <CapabilityImage value={cap} onChange={onChange} descriptor={descriptor} />
          ) : cap.kind === 'video' ? (
            <CapabilityVideo value={cap} onChange={onChange} descriptor={descriptor} />
          ) : (
            <CapabilityTts value={cap} onChange={onChange} descriptor={descriptor} />
          )}
        </CapabilityComparison>
      </div>
      <details open className="lg:sticky lg:top-0">
        <summary className="mb-2 cursor-pointer text-xs text-muted-foreground">参数预览</summary>
        <CanvasPreview name={draft.displayName} capability={cap} descriptor={descriptor} />
      </details>
    </div>
  );
}
