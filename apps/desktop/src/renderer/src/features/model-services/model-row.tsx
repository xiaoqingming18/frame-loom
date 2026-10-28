import { useState } from 'react';
import { AudioLines, Image, MessageSquare, MoreHorizontal, Video } from 'lucide-react';
import { getProtocol } from '@frame-loom/contracts';
import type { Model } from '@frame-loom/contracts/model-service';
import { Button } from '@frame-loom/ui/components/button';
import { Switch } from '@frame-loom/ui/components/switch';
import { Badge } from '@frame-loom/ui/components/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@frame-loom/ui/components/dropdown-menu';
import { ConfirmDialog } from './form-fields';

export function ModelRow({
  model,
  highlight,
  onEdit,
  onCopy,
  onDelete,
  onToggle,
  onTest,
  onExport,
  onImport,
}: {
  model: Model;
  highlight: boolean;
  onEdit: () => void;
  onCopy: () => void;
  onDelete: () => void;
  onToggle: () => void;
  onTest: () => void;
  onExport: () => void;
  onImport: () => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const Icon = { chat: MessageSquare, image: Image, video: Video, tts: AudioLines }[model.kind];
  const cap = model.capability;
  const summary =
    cap.kind === 'image'
      ? `${cap.references.max ?? '不限'} 参考图 · ${cap.mask ? '蒙版 · ' : ''}${cap.size.tiers
          .filter((tier) => tier.enabled)
          .map((tier) => tier.name)
          .join('/')}`
      : cap.kind === 'video'
        ? `${cap.duration.kind === 'range' ? `${cap.duration.min}–${cap.duration.max}s` : cap.duration.kind === 'values' ? cap.duration.values.join('/') + 's' : '交给模型'} · ${cap.resolutions.join('/')} · ${cap.modes.length} 种方式`
        : cap.kind === 'tts'
          ? `${cap.voices.presets.length} 预置音色 · ${cap.formats.join('/')}`
          : cap.inputModalities.length
            ? `文本 + ${cap.inputModalities.join('/')}`
            : '文本';
  return (
    <article
      className={`rounded-xl border bg-card p-3 ${highlight ? 'border-primary' : 'border-border'}`}
    >
      <div className="flex items-center gap-3">
        <Icon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        <button
          type="button"
          className="min-w-0 flex-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={onEdit}
        >
          <span className="block truncate text-sm font-medium">{model.displayName}</span>
          <span className="block truncate font-mono text-xs text-muted-foreground">
            {model.upstreamModelId}
          </span>
        </button>
        <Badge variant="outline" className={!model.protocolId ? 'text-warning' : ''}>
          {model.protocolId ? getProtocol(model.protocolId)?.label : '待选协议'}
        </Badge>
        <span title={model.blockedReason ?? undefined}>
          <Switch
            aria-label={`启用模型 ${model.displayName}`}
            checked={model.enabled}
            disabled={!!model.blockedReason}
            onCheckedChange={onToggle}
          />
        </span>
        <Button
          size="sm"
          variant="ghost"
          onClick={onTest}
          disabled={!model.enabled || !!model.blockedReason}
        >
          测试
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label={`${model.displayName} 更多操作`}>
              <MoreHorizontal aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem onSelect={onEdit}>编辑</DropdownMenuItem>
            <DropdownMenuItem onSelect={onCopy}>复制为新模型</DropdownMenuItem>
            <DropdownMenuItem onSelect={onExport}>导出 JSON</DropdownMenuItem>
            <DropdownMenuItem onSelect={onImport}>导入到此渠道</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setDeleting(true)}>删除</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">{summary}</p>
      <p
        className="mt-1 truncate font-mono text-xs text-muted-foreground"
        title={model.endpoints.operations.submit?.url}
      >
        {model.endpointOverride.submitUrl && <span className="mr-2 font-sans">已覆盖</span>}
        {model.endpoints.operations.submit?.url ?? '选择协议后预览请求地址'}
      </p>
      {model.blockedReason && <p className="mt-1 text-xs text-warning">{model.blockedReason}</p>}
      <p className="mt-1 text-xs text-muted-foreground">
        {model.lastCheck?.configHash === model.configHash
          ? `上次测试：${model.lastCheck.ok ? '通过' : '失败'} · ${model.lastCheck.message}`
          : '尚无当前配置的测试结果，配置修改后旧结果失效'}
      </p>
      {deleting && (
        <ConfirmDialog
          title="删除模型？"
          description="已生成的资产不受影响。"
          onClose={() => setDeleting(false)}
          onConfirm={() => {
            setDeleting(false);
            onDelete();
          }}
          confirmLabel="删除"
        />
      )}
    </article>
  );
}
