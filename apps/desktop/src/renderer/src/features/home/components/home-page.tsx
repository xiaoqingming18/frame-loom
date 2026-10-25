import { ArrowUp, ChevronDown, Folder, Plus, Settings, Wrench } from 'lucide-react';
import type { ComponentProps } from 'react';
import logo from '@/assets/logo.png';
import { Tooltip, TooltipContent, TooltipTrigger } from '@frame-loom/ui/components/tooltip';
import { cn } from '@frame-loom/ui/lib/utils';

function UnavailableButton({ className, ...props }: ComponentProps<'button'>) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          {...props}
          type="button"
          aria-disabled="true"
          aria-describedby="creation-unavailable"
          onClick={(event) => event.preventDefault()}
          className={cn(
            'flex cursor-not-allowed items-center gap-1.5 rounded-md px-2.5 py-1.5 text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring',
            className,
          )}
        />
      </TooltipTrigger>
      <TooltipContent>创作功能尚未开放</TooltipContent>
    </Tooltip>
  );
}

export function HomePage() {
  return (
    <section className="flex min-h-full items-center justify-center px-5 py-16">
      <div className="flex w-full max-w-[860px] -translate-y-[5vh] flex-col items-center">
        <div className="mb-3 flex items-center gap-4">
          <div className="relative size-12 border border-foreground-strong">
            <img src={logo} alt="" className="size-full" />
            <span className="absolute -top-[3px] -left-[3px] size-1.5 bg-foreground-strong" />
            <span className="absolute -top-[3px] -right-[3px] size-1.5 bg-foreground-strong" />
            <span className="absolute -bottom-[3px] -left-[3px] size-1.5 bg-foreground-strong" />
            <span className="absolute -right-[3px] -bottom-[3px] size-1.5 bg-foreground-strong" />
          </div>
          <h1 className="font-serif text-display font-medium tracking-[-0.5px] text-foreground-strong">
            帧织
          </h1>
        </div>
        <p className="mb-10 text-sm text-muted-foreground">每一个故事，都值得被看见</p>
        <p id="creation-unavailable" className="sr-only">
          创作功能尚未开放
        </p>
        <div className="flex w-full max-w-[760px] flex-col items-center">
          <div className="relative z-2 -mb-3 w-full overflow-hidden rounded-2xl border bg-card shadow-panel focus-within:border-border-strong focus-within:shadow-panel-focus">
            <Tooltip>
              <TooltipTrigger asChild>
                <textarea
                  aria-label="创作描述"
                  aria-disabled="true"
                  aria-describedby="creation-unavailable"
                  readOnly
                  placeholder="输入想创作的内容。 @ 选择素材或插件 / 使用技能"
                  className="block min-h-[100px] w-full cursor-not-allowed resize-none bg-transparent px-5 pt-5 pb-2.5 text-sm outline-none placeholder:text-placeholder focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                />
              </TooltipTrigger>
              <TooltipContent>创作功能尚未开放</TooltipContent>
            </Tooltip>
            <div className="flex items-center justify-between gap-2 px-4 py-2.5">
              <div className="flex items-center gap-2">
                <UnavailableButton
                  aria-label="添加素材"
                  className="size-7 justify-center rounded-full bg-accent p-0 text-foreground"
                >
                  <Plus className="size-4" />
                </UnavailableButton>
                <UnavailableButton>
                  <Settings className="size-4" />
                  模型
                </UnavailableButton>
                <UnavailableButton>
                  <Wrench className="size-4" />
                  技能
                </UnavailableButton>
              </div>
              <div className="flex items-center gap-2">
                <UnavailableButton>
                  版本
                  <ChevronDown className="size-3" />
                </UnavailableButton>
                <UnavailableButton
                  aria-label="发送"
                  className="size-7 justify-center rounded-full bg-primary p-0 text-primary-foreground"
                >
                  <ArrowUp className="size-3.5" />
                </UnavailableButton>
              </div>
            </div>
          </div>
          <div className="w-[calc(100%-80px)] rounded-b-2xl border border-t-0 bg-muted pt-6 pr-4 pb-2 pl-6">
            <UnavailableButton className="text-xs">
              <Folder className="size-3.5" />
              选择项目
              <ChevronDown className="size-3.5" />
            </UnavailableButton>
          </div>
        </div>
      </div>
    </section>
  );
}
