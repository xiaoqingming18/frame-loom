import { forwardRef, type ComponentProps, type ReactNode } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@frame-loom/ui/components/tooltip';
import { cn } from '@frame-loom/ui/lib/utils';

type Props = ComponentProps<'button'> & {
  label: string;
  shortcut?: string;
  active?: boolean;
  primary?: boolean;
  size?: 'dock' | 'bar';
  children: ReactNode;
};

/** 浮动栏按钮：中文可访问名称，Tooltip 写明快捷键。 */
export const ToolbarButton = forwardRef<HTMLButtonElement, Props>(function ToolbarButton(
  { label, shortcut, active, primary, size = 'dock', className, children, ...props },
  ref,
) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          ref={ref}
          type="button"
          aria-label={label}
          aria-pressed={active}
          className={cn(
            'inline-flex shrink-0 items-center justify-center gap-1 text-muted-foreground transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40',
            size === 'dock'
              ? 'size-9 rounded-lg [&_svg]:size-[18px]'
              : 'h-7 min-w-7 rounded-md px-2 text-xs [&_svg]:size-4',
            primary
              ? 'bg-primary text-primary-foreground hover:bg-primary/90'
              : 'hover:bg-accent hover:text-foreground',
            active && !primary && 'bg-accent-active text-foreground',
            className,
          )}
          {...props}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side={size === 'dock' ? 'top' : 'bottom'} sideOffset={6}>
        {label}
        {shortcut && <span className="ml-2 opacity-60">{shortcut}</span>}
      </TooltipContent>
    </Tooltip>
  );
});

export function ToolbarDivider({ size = 'dock' }: { size?: 'dock' | 'bar' }) {
  return (
    <span
      aria-hidden="true"
      className={cn('mx-1 w-px shrink-0 bg-border', size === 'dock' ? 'h-5' : 'h-4')}
    />
  );
}
