import type { ReactNode } from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@frame-loom/ui/components/dropdown-menu';

/** 在指定屏幕坐标弹出的菜单，用于右键菜单、双击添加和拖线到空白处。 */
export function PointMenu({
  at,
  onClose,
  label,
  children,
}: {
  at: { x: number; y: number } | null;
  onClose: () => void;
  label: string;
  children: ReactNode;
}) {
  return (
    <DropdownMenu open={!!at} onOpenChange={(open) => !open && onClose()} modal={false}>
      <DropdownMenuTrigger asChild>
        <span
          aria-hidden="true"
          className="pointer-events-none fixed size-0"
          style={{ left: at?.x ?? 0, top: at?.y ?? 0 }}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent aria-label={label} align="start" sideOffset={2} className="min-w-44">
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
