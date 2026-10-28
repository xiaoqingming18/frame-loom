import type { ReactNode } from 'react';
import { CircleHelp } from 'lucide-react';
import { Button } from '@frame-loom/ui/components/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@frame-loom/ui/components/tooltip';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@frame-loom/ui/components/dialog';

export function Field({
  label,
  help,
  children,
}: {
  label: string;
  help?: string;
  children: ReactNode;
}) {
  return (
    <label className="grid min-w-0 gap-1.5 text-xs text-muted-foreground">
      <span className="flex items-center gap-1.5">
        {label}
        {help && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span tabIndex={0} aria-label={`${label}说明`}>
                <CircleHelp aria-hidden="true" className="size-3.5" />
              </span>
            </TooltipTrigger>
            <TooltipContent>{help}</TooltipContent>
          </Tooltip>
        )}
      </span>
      {children}
    </label>
  );
}
export function ErrorMessage({ error }: { error: unknown }) {
  return error ? (
    <p role="alert" className="text-sm text-destructive">
      {error instanceof Error
        ? error.message
        : typeof error === 'string'
          ? error
          : '操作失败，请重试'}
    </p>
  ) : null;
}
export function ConfirmDialog({
  title,
  description,
  onConfirm,
  onClose,
  confirmLabel = '确认',
}: {
  title: string;
  description: ReactNode;
  onConfirm: () => void;
  onClose: () => void;
  confirmLabel?: string;
}) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription asChild>
          <div className="text-sm text-muted-foreground">{description}</div>
        </DialogDescription>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button onClick={onConfirm}>{confirmLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
