import { Cloud, Info, Palette, Server, Settings2, Star, X } from 'lucide-react';
import logo from '@/assets/logo.png';
import { Button } from '@frame-loom/ui/components/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@frame-loom/ui/components/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@frame-loom/ui/components/tabs';
import { AppearanceSettings } from '@/features/theme/components/appearance-settings';
import { EngineStatusPanel } from '@/features/engine-status/components/engine-status-panel';
import { ModelServices } from '@/features/model-services/model-services';
import { ModelDefaultsSettings } from '@/features/model-services/model-defaults';
import { ObjectStorageSettings } from '@/features/object-storage/object-storage-settings';
import type { EngineClient } from '@/lib/engine-client';
import { settingsTab, type SettingsTab } from './settings-search';

export function SettingsDialog({
  tab,
  onTabChange,
  engineClient,
}: {
  tab?: SettingsTab;
  onTabChange: (tab?: SettingsTab) => void;
  engineClient: EngineClient;
}) {
  return (
    <Dialog
      open={!!tab}
      onOpenChange={(open) => {
        if (!open) onTabChange();
      }}
    >
      <DialogContent
        className="h-[min(640px,calc(100dvh-7rem))] w-[calc(100%-3rem)] gap-0 overflow-hidden rounded-[20px] bg-muted p-1 shadow-panel-focus sm:max-w-[1000px]"
        showCloseButton={false}
        onInteractOutside={(event) => {
          // 窗口按钮属于系统级操作，不应因最小化或最大化而关闭设置。
          const target = event.target;
          if (target instanceof Element && target.closest('.window-controls'))
            event.preventDefault();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          document.getElementById('settings-button')?.focus();
        }}
      >
        <DialogTitle className="sr-only">设置中心</DialogTitle>
        <DialogDescription className="sr-only">
          管理工作台外观，查看本地引擎与应用信息。
        </DialogDescription>
        <DialogClose asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label="关闭"
            className="absolute top-4 right-4 z-10 rounded-full text-muted-foreground"
          >
            <X aria-hidden="true" className="size-5" />
          </Button>
        </DialogClose>
        <Tabs
          orientation="vertical"
          value={tab}
          onValueChange={(value) => onTabChange(settingsTab.parse(value))}
          className="min-h-0 gap-0"
        >
          <div className="w-44 shrink-0 overflow-y-auto px-2 py-6 sm:w-52 md:w-56">
            <p className="mb-5 px-3 text-sm text-muted-foreground">设置</p>
            <TabsList aria-label="设置分类" className="w-full gap-1.5 bg-transparent p-0">
              {(
                [
                  { value: 'appearance', label: '外观', Icon: Palette },
                  { value: 'engine', label: '本地引擎', Icon: Server },
                  { value: 'models', label: '模型服务', Icon: Settings2 },
                  { value: 'defaults', label: '默认模型', Icon: Star },
                  { value: 'storage', label: '对象存储', Icon: Cloud },
                  { value: 'about', label: '关于', Icon: Info },
                ] as const
              ).map(({ value, label, Icon }) => (
                <TabsTrigger
                  key={value}
                  value={value}
                  className="h-11 flex-none gap-3 rounded-xl px-3 font-normal hover:bg-accent data-[state=active]:bg-accent-active data-[state=active]:shadow-none"
                >
                  <Icon aria-hidden="true" />
                  {label}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
          <TabsContent
            value="appearance"
            className="min-w-0 overflow-y-auto rounded-2xl bg-card px-6 py-8 lg:px-9"
          >
            <AppearanceSettings />
          </TabsContent>
          <TabsContent
            value="engine"
            className="min-w-0 overflow-y-auto rounded-2xl bg-card px-6 py-8 lg:px-9"
          >
            <EngineStatusPanel engineClient={engineClient} />
          </TabsContent>
          <TabsContent
            value="models"
            className="min-w-0 overflow-y-auto rounded-2xl bg-card px-6 py-8 lg:px-9"
          >
            <ModelServices
              engineClient={engineClient}
              onOpenStorage={() => onTabChange('storage')}
            />
          </TabsContent>
          <TabsContent
            value="defaults"
            className="min-w-0 overflow-y-auto rounded-2xl bg-card px-6 py-8 lg:px-9"
          >
            <ModelDefaultsSettings
              engineClient={engineClient}
              onOpenModels={() => onTabChange('models')}
            />
          </TabsContent>
          <TabsContent
            value="about"
            className="min-w-0 overflow-y-auto rounded-2xl bg-card px-6 py-8 lg:px-9"
          >
            <section aria-labelledby="about-heading">
              <h2 id="about-heading" className="text-xl font-semibold">
                关于
              </h2>
              <div className="mt-9 flex items-center gap-4">
                <img src={logo} alt="帧织 logo" className="size-14 rounded-2xl" />
                <div>
                  <h3 className="font-serif text-lg">帧织 · Frame Loom</h3>
                  <p className="mt-1.5 text-xs text-muted-foreground">影视创作工作台</p>
                </div>
              </div>
              <dl className="mt-8">
                <div className="flex items-center justify-between gap-4 py-4 text-sm">
                  <dt>应用版本</dt>
                  <dd data-testid="app-version" className="text-muted-foreground">
                    {__APP_VERSION__}
                  </dd>
                </div>
              </dl>
            </section>
          </TabsContent>
          <TabsContent
            value="storage"
            className="min-w-0 overflow-y-auto rounded-2xl bg-card px-6 py-8 lg:px-9"
          >
            <ObjectStorageSettings client={engineClient} />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
